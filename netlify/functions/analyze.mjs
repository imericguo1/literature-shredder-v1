import Busboy from "busboy";
import pdfParse from "pdf-parse";

const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const MAX_TOTAL_UPLOAD_BYTES = 9 * 1024 * 1024;
const MAX_CHARS_PER_FILE = 60000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function friendlyError(error) {
  const text = String(error?.message || error || "");
  if (/invalid.*api key|incorrect api key|unauthorized|authentication/i.test(text)) {
    return "API Key 无效或没有权限。请检查页面中的 DeepSeek API Key。";
  }
  if (/quota|billing|credits|insufficient balance/i.test(text)) {
    return "当前 API 额度不足。请到 DeepSeek 开放平台检查账户余额后再试。";
  }
  if (/rate limit|too many requests/i.test(text)) {
    return "请求太频繁了。请稍等一会儿再重新分析。";
  }
  if (/pdf|no text|parse/i.test(text)) {
    return "PDF 文字提取失败。请确认不是扫描版图片 PDF，或先用 OCR 转成可复制文字的 PDF。";
  }
  return text || "分析失败，请稍后再试。";
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const files = [];
    const busboy = Busboy({ headers: { "content-type": contentType } });

    busboy.on("file", (_fieldName, file, info) => {
      const chunks = [];
      let size = 0;
      file.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });
      file.on("end", () => {
        if (!info.filename) return;
        files.push({
          filename: info.filename,
          mimeType: info.mimeType,
          data: Buffer.concat(chunks, size)
        });
      });
    });
    busboy.on("error", reject);
    busboy.on("finish", () => resolve(files));
    busboy.end(Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8"));
  });
}

function truncateText(text) {
  if (text.length <= MAX_CHARS_PER_FILE) return text;
  const headLength = Math.floor(MAX_CHARS_PER_FILE * 0.58);
  const tailLength = MAX_CHARS_PER_FILE - headLength;
  return [
    text.slice(0, headLength),
    "\n\n[中间部分因篇幅较长已省略；请重点结合开头理论框架与末尾参考文献分析。]\n\n",
    text.slice(-tailLength)
  ].join("");
}

async function extractPdf(file) {
  const parsed = await pdfParse(file.data);
  const text = String(parsed.text || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`PDF parse failed: ${file.filename} has no text`);
  return {
    filename: file.filename,
    page_count: parsed.numpages || 0,
    text: truncateText(text)
  };
}

function buildPrompt(files) {
  const comparisonRules = files.length > 1
    ? `Also generate a comparison object across the uploaded documents:
- available: true
- shared_topics: overlapping research questions, themes, or concerns
- key_differences: main disagreements or different emphases
- method_comparison: contrasts in theory, method, evidence, or dataset
- reference_overlap: duplicated or closely related cited works
- synthesis: concise Chinese synthesis of how these papers relate`
    : `Since only one document is provided, set:
- available: false
- shared_topics, key_differences, method_comparison, reference_overlap: empty arrays
- synthesis: a short Chinese sentence stating that cross-paper comparison is unavailable with a single file`;

  return `You are analyzing academic PDF documents. Return valid JSON only.

For each document:
1. Identify the paper title.
2. Write a concise Chinese summary of the main thesis and contribution.
3. Extract main points as short Chinese bullet-like strings.
4. Reconstruct the argument process in Chinese. Each step must include step, reasoning, evidence.
5. Extract 3 to 8 exact core quotes when possible. Include why_it_matters and location_hint.
6. List every cited reference you can reliably identify from bibliography/references. Preserve raw_citation.
7. If bibliography details are unclear, keep raw citation and mark completeness as partial or uncertain.

${comparisonRules}

Output exactly this JSON shape:
{
  "documents": [{
    "filename": string,
    "document_title": string,
    "summary": string,
    "main_points": string[],
    "argument_process": [{ "step": string, "reasoning": string, "evidence": string }],
    "core_quotes": [{ "quote": string, "why_it_matters": string, "location_hint": string }],
    "references": [{
      "raw_citation": string,
      "authors": string,
      "year": string,
      "title": string,
      "source": string,
      "details": string,
      "identifier": string,
      "completeness": "complete" | "partial" | "uncertain"
    }]
  }],
  "comparison": {
    "available": boolean,
    "shared_topics": string[],
    "key_differences": string[],
    "method_comparison": string[],
    "reference_overlap": string[],
    "synthesis": string
  }
}

Documents:
${files.map((file, index) => `===== Document ${index + 1} =====
Filename: ${file.filename}
Page count: ${file.page_count}
Extracted text:
${file.text}`).join("\n\n")}`;
}

function parseJsonContent(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(text);
}

async function callDeepSeek(apiKey, model, files) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a careful academic research assistant. Return JSON only. Do not invent citations or quotes." },
        { role: "user", content: buildPrompt(files) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 8192
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek request failed with ${response.status}`);
  return parseJsonContent(payload.choices?.[0]?.message?.content || "{}");
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const apiKey = String(event.headers["x-deepseek-api-key"] || process.env.DEEPSEEK_API_KEY || "").trim();
    if (!apiKey) return json(400, { error: "缺少 DeepSeek API Key。请先在页面中填写。" });

    const model = String(event.headers["x-deepseek-model"] || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const files = await parseMultipart(event);
    if (!files.length) return json(400, { error: "请至少上传一个 PDF 文件。" });
    if (!files.every((file) => file.filename.toLowerCase().endsWith(".pdf"))) return json(400, { error: "当前仅支持 PDF 文件。" });
    const totalSize = files.reduce((sum, file) => sum + file.data.length, 0);
    if (totalSize > MAX_TOTAL_UPLOAD_BYTES) return json(400, { error: "Netlify 公网版单次上传建议不超过 9MB。请压缩 PDF 或分批分析。" });

    const extracted = await Promise.all(files.map(extractPdf));
    const result = await callDeepSeek(apiKey, model, extracted);
    return json(200, result);
  } catch (error) {
    return json(500, { error: friendlyError(error) });
  }
};
