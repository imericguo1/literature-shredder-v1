const form = document.getElementById("analyze-form");
const apiKeyInput = document.getElementById("api-key");
const rememberKeyInput = document.getElementById("remember-key");
const modelSelect = document.getElementById("model-select");
const papersInput = document.getElementById("papers");
const dropZone = document.getElementById("drop-zone");
const fileList = document.getElementById("file-list");
const statusBox = document.getElementById("status");
const serviceState = document.getElementById("service-state");
const comparisonBox = document.getElementById("comparison");
const resultsBox = document.getElementById("results");
const template = document.getElementById("result-template");
const comparisonTemplate = document.getElementById("comparison-template");
const submitButton = document.getElementById("submit-button");
const clearButton = document.getElementById("clear-button");
const exportButton = document.getElementById("export-button");
const jsonButton = document.getElementById("json-button");
const csvButton = document.getElementById("csv-button");
const copyButton = document.getElementById("copy-button");

let latestResult = null;
let selectedFiles = [];

const storedKey = window.localStorage.getItem("paper-digest-deepseek-api-key");
if (storedKey) {
  apiKeyInput.value = storedKey;
  rememberKeyInput.checked = true;
}

function setStatus(message, kind = "info") {
  statusBox.textContent = message;
  statusBox.dataset.kind = kind;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function setExportEnabled(enabled) {
  [exportButton, jsonButton, csvButton, copyButton].forEach((button) => {
    button.disabled = !enabled;
  });
}

function syncNativeFileInput() {
  const dt = new DataTransfer();
  selectedFiles.forEach((file) => dt.items.add(file));
  papersInput.files = dt.files;
}

function renderFileList() {
  fileList.innerHTML = "";
  if (!selectedFiles.length) {
    fileList.innerHTML = '<p class="file-pill muted">还没有选择文件</p>';
    return;
  }

  selectedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "file-pill";
    const label = document.createElement("span");
    label.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "icon-button";
    removeButton.title = "移除文件";
    removeButton.setAttribute("aria-label", `移除 ${file.name}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      syncNativeFileInput();
      renderFileList();
    });
    item.append(label, removeButton);
    fileList.appendChild(item);
  });
}

function setFiles(fileListLike) {
  const incoming = Array.from(fileListLike || []).filter((file) => {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  });

  incoming.forEach((file) => {
    const duplicate = selectedFiles.some((existing) => {
      return existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified;
    });
    if (!duplicate) selectedFiles.push(file);
  });

  syncNativeFileInput();
  renderFileList();
  setStatus(incoming.length ? `已选择 ${selectedFiles.length} 个 PDF 文件。` : "这里只支持 PDF 文件。", incoming.length ? "info" : "error");
}

function createList(items, className) {
  const ul = document.createElement("ul");
  ul.className = className;
  (items || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  });
  return ul;
}

function createFallbackList(targetClass, emptyText) {
  return createList([emptyText], targetClass);
}

function renderArgumentProcess(list, target) {
  target.innerHTML = "";
  (list || []).forEach((item, index) => {
    const block = document.createElement("article");
    block.className = "stack-item";
    const marker = document.createElement("div");
    marker.className = "stack-index";
    marker.textContent = String(index + 1).padStart(2, "0");
    const body = document.createElement("div");
    body.className = "stack-body";
    const title = document.createElement("h4");
    title.textContent = item.step || `步骤 ${index + 1}`;
    const reasoning = document.createElement("p");
    reasoning.textContent = item.reasoning || "";
    const evidence = document.createElement("p");
    evidence.className = "evidence";
    evidence.textContent = item.evidence || "";
    body.append(title, reasoning, evidence);
    block.append(marker, body);
    target.appendChild(block);
  });
}

function renderQuotes(list, target) {
  target.innerHTML = "";
  (list || []).forEach((item) => {
    const quote = document.createElement("article");
    quote.className = "quote-card";
    const quoteText = document.createElement("blockquote");
    quoteText.textContent = item.quote || "";
    const reason = document.createElement("p");
    reason.textContent = item.why_it_matters || "";
    quote.append(quoteText, reason);
    if (item.location_hint) {
      const location = document.createElement("span");
      location.className = "location";
      location.textContent = item.location_hint;
      quote.appendChild(location);
    }
    target.appendChild(quote);
  });
}

function renderReferences(list, metaTarget, listTarget) {
  metaTarget.textContent = `共识别到 ${(list || []).length} 条引用记录`;
  listTarget.innerHTML = "";
  const ol = document.createElement("ol");
  ol.className = "raw-reference-list";
  (list || []).forEach((item, index) => {
    const ref = document.createElement("li");
    ref.className = "raw-reference-item";
    ref.value = index + 1;
    ref.textContent = item.raw_citation || "未识别到原始引用文本";
    ol.appendChild(ref);
  });
  listTarget.appendChild(ol);
}

function renderComparison(comparison) {
  comparisonBox.innerHTML = "";
  if (!comparison || !comparison.available) return;
  const node = comparisonTemplate.content.cloneNode(true);
  node.querySelector(".shared-topics").replaceWith((comparison.shared_topics || []).length ? createList(comparison.shared_topics, "shared-topics") : createFallbackList("shared-topics", "未识别到明确共同主题"));
  node.querySelector(".key-differences").replaceWith((comparison.key_differences || []).length ? createList(comparison.key_differences, "key-differences") : createFallbackList("key-differences", "未识别到明显分歧"));
  node.querySelector(".method-comparison").replaceWith((comparison.method_comparison || []).length ? createList(comparison.method_comparison, "method-comparison") : createFallbackList("method-comparison", "方法层面对比信息不足"));
  node.querySelector(".reference-overlap").replaceWith((comparison.reference_overlap || []).length ? createList(comparison.reference_overlap, "reference-overlap") : createFallbackList("reference-overlap", "未识别到明显重合引用"));
  node.querySelector(".synthesis").textContent = comparison.synthesis || "";
  comparisonBox.appendChild(node);
}

function renderResults(documents) {
  resultsBox.innerHTML = "";
  resultsBox.classList.remove("empty-state");
  (documents || []).forEach((doc) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".paper-file").textContent = doc.filename || "";
    node.querySelector(".paper-title").textContent = doc.document_title || "未识别标题";
    node.querySelector(".summary").textContent = doc.summary || "";
    node.querySelector(".main-points").replaceWith(createList(doc.main_points || [], "main-points"));
    renderArgumentProcess(doc.argument_process, node.querySelector(".argument-list"));
    renderQuotes(doc.core_quotes, node.querySelector(".quote-list"));
    renderReferences(doc.references, node.querySelector(".reference-meta"), node.querySelector(".reference-list"));
    resultsBox.appendChild(node);
  });
}

function escapeMarkdown(text) {
  return String(text || "").replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function buildMarkdown(result) {
  const lines = ["# 文献粉碎机分析结果", ""];
  if (result.comparison?.available) {
    lines.push("## 多篇论文对比", "", `**综合判断**：${result.comparison.synthesis || ""}`, "");
    [["共同主题", result.comparison.shared_topics], ["关键差异", result.comparison.key_differences], ["方法比较", result.comparison.method_comparison], ["参考文献重合", result.comparison.reference_overlap]].forEach(([title, items]) => {
      lines.push(`### ${title}`);
      (items || []).forEach((item) => lines.push(`- ${escapeMarkdown(item)}`));
      lines.push("");
    });
  }
  (result.documents || []).forEach((doc, index) => {
    lines.push(`## ${index + 1}. ${escapeMarkdown(doc.document_title || "未识别标题")}`, "", `原文件：${escapeMarkdown(doc.filename)}`, "", "### 摘要", doc.summary || "", "", "### 主要观点");
    (doc.main_points || []).forEach((item) => lines.push(`- ${escapeMarkdown(item)}`));
    lines.push("", "### 论证过程");
    (doc.argument_process || []).forEach((item, stepIndex) => {
      lines.push(`${stepIndex + 1}. ${escapeMarkdown(item.step)}`);
      lines.push(`   - 推理：${escapeMarkdown(item.reasoning)}`);
      lines.push(`   - 证据：${escapeMarkdown(item.evidence)}`);
    });
    lines.push("", "### 核心语句");
    (doc.core_quotes || []).forEach((item) => {
      lines.push(`- "${String(item.quote || "").replace(/"/g, '\\"')}"`);
      lines.push(`  说明：${escapeMarkdown(item.why_it_matters)}`);
      if (item.location_hint) lines.push(`  位置：${escapeMarkdown(item.location_hint)}`);
    });
    lines.push("", "### 引用文献");
    (doc.references || []).forEach((item) => lines.push(`- ${escapeMarkdown(item.raw_citation)}`));
    lines.push("");
  });
  return lines.join("\n");
}

function downloadText(content, type, extension) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const suffix = extension.startsWith(".") ? extension.slice(1) : extension;
  anchor.href = url;
  anchor.download = `literature-shredder-${new Date().toISOString().slice(0, 10)}.${suffix}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportMarkdown() {
  if (latestResult) downloadText(buildMarkdown(latestResult), "text/markdown;charset=utf-8", "md");
}

function exportJson() {
  if (latestResult) downloadText(JSON.stringify(latestResult, null, 2), "application/json;charset=utf-8", "json");
}

function csvCell(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function exportReferenceCsv() {
  if (!latestResult) return;
  const rows = [["文件名", "原始引用", "作者", "年份", "标题", "来源", "详情", "标识符", "完整度"]];
  (latestResult.documents || []).forEach((doc) => {
    (doc.references || []).forEach((ref) => rows.push([doc.filename, ref.raw_citation, ref.authors, ref.year, ref.title, ref.source, ref.details, ref.identifier, ref.completeness]));
  });
  downloadText(`\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`, "text/csv;charset=utf-8", "references.csv");
}

async function copyResult() {
  if (!latestResult) return;
  await navigator.clipboard.writeText(buildMarkdown(latestResult));
  setStatus("分析结果已复制。", "success");
}

async function checkService() {
  try {
    const response = await fetch("/health");
    const payload = await response.json();
    serviceState.textContent = payload.ok ? "服务已连接" : "服务异常";
    serviceState.dataset.kind = payload.ok ? "success" : "error";
  } catch {
    serviceState.textContent = "服务未连接";
    serviceState.dataset.kind = "error";
  }
}

papersInput.addEventListener("change", (event) => setFiles(event.target.files));
papersInput.addEventListener("click", (event) => event.stopPropagation());
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.dataset.dragging = "true";
});
dropZone.addEventListener("dragleave", () => delete dropZone.dataset.dragging);
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  delete dropZone.dataset.dragging;
  setFiles(event.dataTransfer.files);
});
dropZone.addEventListener("click", (event) => {
  if (event.target !== papersInput) papersInput.click();
});
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    papersInput.click();
  }
});

exportButton.addEventListener("click", exportMarkdown);
jsonButton.addEventListener("click", exportJson);
csvButton.addEventListener("click", exportReferenceCsv);
copyButton.addEventListener("click", copyResult);
clearButton.addEventListener("click", () => {
  selectedFiles = [];
  syncNativeFileInput();
  renderFileList();
  setStatus("文件列表已清空。", "info");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFiles.length) {
    setStatus("先选择至少一个 PDF 文件。", "error");
    return;
  }
  const apiKey = apiKeyInput.value.trim();
  if (apiKey && rememberKeyInput.checked) {
    window.localStorage.setItem("paper-digest-deepseek-api-key", apiKey);
  } else {
    window.localStorage.removeItem("paper-digest-deepseek-api-key");
  }
  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append("papers", file));
  submitButton.disabled = true;
  setExportEnabled(false);
  setStatus("正在读取论文并生成结构化总结，这一步通常需要几十秒。", "loading");
  comparisonBox.innerHTML = "";
  resultsBox.classList.add("empty-state");
  resultsBox.innerHTML = "<h2>正在分析</h2><p>论文内容已经提交，稍等一下。</p>";
  latestResult = null;
  try {
    const response = await fetch("/analyze", {
      method: "POST",
      body: formData,
      headers: {
        ...(apiKey ? { "x-deepseek-api-key": apiKey } : {}),
        "x-deepseek-model": modelSelect.value
      }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "分析失败");
    latestResult = payload;
    renderComparison(payload.comparison);
    renderResults(payload.documents || []);
    setExportEnabled(true);
    setStatus("分析完成，可以继续上传下一批论文。", "success");
  } catch (error) {
    resultsBox.classList.add("empty-state");
    resultsBox.innerHTML = "<h2>分析没有完成</h2><p>请根据提示调整后重试。</p>";
    setStatus(error.message || "分析失败，请稍后再试。", "error");
  } finally {
    submitButton.disabled = false;
  }
});

renderFileList();
checkService();
