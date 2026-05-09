# 文献粉碎机 V1.0

一个本地网页工具：上传论文或期刊 PDF 后，自动生成结构化文献分析结果。

## 功能

- 总结论文主要观点
- 梳理论证过程
- 提取核心语句
- 列出原始引用文献
- 支持多篇 PDF 批量分析
- 支持 DeepSeek 模型分析
- 支持复制结果、导出 Markdown、JSON 和引用 CSV

## 运行方式

```bash
ruby server.rb
```

然后在浏览器访问：

```text
http://127.0.0.1:4567
```

## DeepSeek API Key

页面里可以直接填写 DeepSeek API Key。也可以在启动前设置环境变量：

```bash
export DEEPSEEK_API_KEY=你的密钥
ruby server.rb
```

默认模型是 `deepseek-v4-flash`，也可以调整：

```bash
DEEPSEEK_MODEL=deepseek-v4-pro ruby server.rb
```

## PDF 说明

当前版本会先在本机提取 PDF 文字，再调用 DeepSeek 生成结构化分析。

如果 PDF 是扫描版图片，建议先 OCR 成可复制文字的 PDF 后再上传。

## 部署

### Docker

```bash
docker build -t literature-shredder-v1 .
docker run --rm -p 4567:4567 \
  -e BIND_ADDRESS=0.0.0.0 \
  -e DEEPSEEK_API_KEY=你的密钥 \
  literature-shredder-v1
```

### Render

仓库里包含 `render.yaml`。部署时建议设置：

- `BIND_ADDRESS=0.0.0.0`
- `PORT=4567`
- `DEEPSEEK_API_KEY`：可选；不填则使用者在页面里填写自己的 Key

## 注意

- 不要把真实 API Key 写进仓库。
- 单次上传 PDF 建议控制在 50MB 以内。
- DeepSeek 分析长文献可能需要等待几十秒到数分钟。
