# AnnSight v4.0 多格式内容提取增强 - 使用指南

**版本**: v4.0
**日期**: 2026-03-22
**状态**: ✅ 已完成并通过测试

---

## 📋 目录

1. [快速开始](#快速开始)
2. [功能特性](#功能特性)
3. [API 参考](#api 参考)
4. [前端使用](#前端使用)
5. [环境配置](#环境配置)
6. [测试报告](#测试报告)

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd /home/admin/projects/annsight-data-manager
npm install
```

已新增依赖：
- `axios` - HTTP 客户端
- `form-data` - FormData 支持
- `jsonpath` - JSONPath 查询
- `tesseract.js` - OCR 识别

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置必要的变量
```

关键配置：
```bash
# 临时目录
DOWNLOAD_TEMP_DIR=/tmp/annsight-downloads
UPLOAD_TEMP_DIR=/tmp/annsight-uploads

# Whisper API（视频/音频转录）
OPENCLAW_WHISPER_URL=http://localhost:8000/v1/audio/transcriptions
OPENCLAW_WHISPER_TOKEN=your-token

# OCR 引擎
OCR_ENGINE=tesseract
```

### 3. 启动服务

```bash
npm start
# 或开发模式
npm run dev
```

---

## ✨ 功能特性

### 支持的内容格式

| 格式 | 扩展名 | 提取方式 |
|------|--------|----------|
| 文本 | .txt, .csv, .md | 直接读取 |
| JSON | .json | JSONPath 提取 |
| 视频 | .mp4, .mov, .webm | Whisper 转录 |
| 音频 | .mp3, .wav, .m4a | Whisper 转录 |
| 图片 | .jpg, .png, .gif | OCR 识别 |
| URL | 知乎/小红书/B 站等 | 下载 + 转录/抓取 |

### 平台支持

| 平台 | 支持类型 | 下载器 |
|------|----------|--------|
| 知乎 | 视频/文章 | `ZhihuDownloader` |
| 小红书 | 视频 | `XiaohongshuDownloader` |
| B 站 | 视频 | 预留 |
| 通用网页 | 图文 | `GenericDownloader` |
| 直接链接 | 图片/音频/视频 | `UrlDownloader` |

---

## 📡 API 参考

### POST /api/raw-data/upload

多格式内容上传接口（支持 URL、文件、文本）

**请求体**:
```json
{
  "urls": [
    "https://www.zhihu.com/question/123456",
    "https://example.com/data.json"
  ],
  "batchId": "batch-001",
  "source": "zhihu",
  "jsonPath": "$.data[*].content",
  "purposes": ["rag", "finetuning"],
  "fissionConfig": {
    "rag": { "count": 3, "requirement": "提取知识点" },
    "finetuning": { "count": 2, "requirement": "生成对话" }
  }
}
```

**响应**:
```json
{
  "success": true,
  "total": 2,
  "successCount": 2,
  "totalFissionCount": 10,
  "results": [
    {
      "success": true,
      "id": "rd-123456-abc",
      "url": "https://www.zhihu.com/question/123456",
      "extractedText": "知乎内容...",
      "processedDataIds": ["pd-...", "pd-..."],
      "fissionCount": 5
    }
  ]
}
```

### POST /api/raw-data/batch-text

纯文本批量上传（向后兼容）

**请求体**:
```json
{
  "texts": ["文本 1", "文本 2", "文本 3"],
  "batchId": "batch-001",
  "source": "submission",
  "purposes": ["rag", "finetuning"]
}
```

---

## 🖥️ 前端使用

### 1. 打开源数据管理页面

访问：`http://localhost:3000/raw-data.html`

### 2. 选择上传方式

**📝 文本输入**
- 直接粘贴文本内容
- 每行一条数据

**🔗 链接上传**（新增）
- 输入平台链接（知乎/小红书/B 站等）
- 每行一个链接
- 可选配置 JSONPath

**📁 文件上传**
- 拖拽文件或点击选择
- 支持 TXT/CSV/JSON 格式

### 3. 配置裂变（可选）

启用裂变后，可为每种用途设置：
- 期望生成数量
- 具体要求说明（作为 LLM 提示词）

---

## 🧪 测试报告

### UAT 测试结果

运行测试：
```bash
node tests/uat/v4/test-multi-format.js
```

**测试覆盖**:
- 下载器平台识别（7 项）
- 文本提取器（4 项）
- JSON 提取器（8 项）
- ContentRouter（9 项）
- 集成测试（2 项）

**结果**: ✅ 30/30 通过 (100%)

| 测试组 | 测试项 | 状态 |
|--------|--------|------|
| 下载器平台识别 | 7 项 | ✅ |
| 文本提取器 | 4 项 | ✅ |
| JSON 提取器 | 8 项 | ✅ |
| ContentRouter | 9 项 | ✅ |
| 集成测试 | 2 项 | ✅ |

---

## 🔧 架构设计

### 下载器架构

```
BaseDownloader (基类)
├── ZhihuDownloader (知乎)
├── UrlDownloader (通用 URL)
└── GenericDownloader (Playwright)
```

### 提取器架构

```
ContentRouter (路由)
├── TextExtractor (文本/CSV)
├── JsonExtractor (JSON)
├── AudioExtractor (音频/视频转录)
├── ImageExtractor (OCR)
└── UrlExtractor (URL 整合)
```

### 数据流

```
上传 → ContentRouter → 提取器 → ETL → 加工数据表
                              ↓
                        { text, metadata }
```

---

## 📁 文件清单

### 新增文件

```
src/services/downloaders/
├── base.js           # 下载器基类
├── registry.js       # 注册表
├── zhihu.js          # 知乎下载器
├── url.js            # 通用 URL 下载器
└── generic.js        # Playwright 下载器

src/services/extractors/
├── text-extractor.js    # 文本/CSV
├── json-extractor.js    # JSON
├── audio-extractor.js   # 音频/视频
├── image-extractor.js   # OCR
└── url-extractor.js     # URL 整合

src/services/
└── content-router.js    # 内容路由

tests/uat/v4/
└── test-multi-format.js # UAT 测试

.env.example             # 环境配置示例
IMPLEMENTATION-v4.md     # 实施报告
USAGE-v4.md              # 本文件
```

### 修改的文件

```
src/routes/raw-data.js       # 新增 uploadHandler
public/raw-data.html         # 新增 URL 上传标签页
package.json                 # 新增依赖
```

---

## ⚠️ 注意事项

1. **Whisper 配置**: 视频/音频转录需要配置 Whisper API 或本地 CLI
2. **OCR 准确率**: Tesseract.js 对中文识别准确率有限，建议使用阿里云 OCR
3. **Playwright**: 首次运行需要安装浏览器 `npx playwright install`
4. **临时目录**: 确保 `DOWNLOAD_TEMP_DIR` 和 `UPLOAD_TEMP_DIR` 有写入权限
5. **批量上传**: 建议单次不超过 100 个 URL，避免超时

---

## 📞 技术支持

- 实施报告：`IMPLEMENTATION-v4.md`
- 测试脚本：`tests/uat/v4/test-multi-format.js`
- 环境配置：`.env.example`
