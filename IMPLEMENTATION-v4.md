# AnnSight 多格式内容提取增强 (v4.0) 实施报告

**日期**: 2026-03-22
**状态**: ✅ 核心功能已完成

---

## 实施摘要

本次实施完成了 AnnSight 数据全流程管理系统的 v4.0 多格式内容提取增强方案，主要包含以下核心功能：

1. **下载器架构集成** - 复用 xiaohongshu-manager 的下载器设计模式
2. **内容提取器实现** - 支持文本、JSON、音频、视频、图片、URL 多种格式
3. **内容路由层** - 自动识别内容类型并路由到对应提取器
4. **API 层增强** - 新增 `/api/raw-data/upload` 接口支持多格式上传
5. **前端增强** - 新增 URL 上传标签页，支持链接批量提交

---

## 已实现的文件

### Phase B: 下载器架构

| 文件 | 说明 |
|------|------|
| `src/services/downloaders/base.js` | 下载器基类，定义标准接口 |
| `src/services/downloaders/registry.js` | 下载器注册表，统一管理 |
| `src/services/downloaders/zhihu.js` | 知乎下载器（视频 + 文章） |
| `src/services/downloaders/url.js` | 通用 URL 下载器（直接文件链接） |
| `src/services/downloaders/generic.js` | 通用网页下载器（Playwright） |

**支持的平台**:
- 知乎（视频/文章）
- 小红书（复用已有）
- B 站（预留）
- 通用网页（Playwright 抓取）
- 直接文件链接（图片/音频/视频）

### Phase C: 内容提取器

| 文件 | 说明 | 技术栈 |
|------|------|--------|
| `src/services/extractors/text-extractor.js` | 文本/CSV 提取 | fs |
| `src/services/extractors/json-extractor.js` | JSON 提取（支持 JSONPath） | 自定义 JSONPath |
| `src/services/extractors/audio-extractor.js` | 音频/视频转录 | Whisper API/CLI |
| `src/services/extractors/image-extractor.js` | 图片 OCR | Tesseract.js / 阿里云 OCR |
| `src/services/extractors/url-extractor.js` | URL 内容抓取 | Playwright + 下载器 |

### Phase D: 内容路由层

| 文件 | 说明 |
|------|------|
| `src/services/content-router.js` | 内容路由核心，自动识别类型并分发 |

**路由逻辑**:
```
输入 → 类型识别 → 对应提取器 → 标准化输出 { text, metadata }
```

### Phase E: API 层集成

**更新的文件**:
- `src/routes/raw-data.js` - 新增 `uploadHandler` 函数

**新增 API**:
```
POST /api/raw-data/upload
Body: {
  urls: string[],      // URL 列表
  batchId: string,
  source: string,
  jsonPath?: string,   // JSON 提取路径（可选）
  purposes?: string[], // 用途列表
  fissionConfig?: obj  // 裂变配置
}
```

### Phase A: 前端增强

**更新的文件**:
- `public/raw-data.html`

**新增功能**:
1. URL 上传标签页（🔗 链接上传）
2. 智能 JSON 提取配置输入框
3. 多平台链接支持（知乎/小红书/B 站/通用）
4. URL 裂变配置面板

---

## 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                     前端上传界面                             │
│  - 文本输入 / URL 链接 / 文件拖拽                             │
│  - 智能识别内容类型                                          │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│              API: POST /api/raw-data/upload                 │
│  - 接收 URL/文件/文本                                        │
│  - 调用 ContentRouter 路由到对应提取器                        │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                    内容提取层                                │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐ │
│  │TextExtractor│JsonExtractor│AudioExtractor│UrlExtractor │ │
│  └─────────────┴─────────────┴─────────────┴─────────────┘ │
│         ↓              ↓              ↓              ↓       │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              标准化输出：{ text, metadata }              ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                    ETL 处理管道                              │
│  L1 清洗 → L2.5 裂变 → L2 结构化 → L3 评估 → 去重             │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                    加工数据表                                │
│  - 冷却期 24h                                                │
│  - AI 置信度评分                                              │
│  - 审核状态跟踪                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 待完成的工作

### P0: 本周完成
- [ ] 测试 URL 上传全流程
- [ ] 配置 Whisper API 集成
- [ ] 添加必要的环境变量到 `.env`

### P1: 下周完成
- [ ] 视频/音频转录测试（需要 Whisper 环境）
- [ ] 图片 OCR 测试（需要 Tesseract.js 或阿里云 OCR）
- [ ] 完善错误处理和日志

### P2: 后续迭代
- [ ] 批量链接抓取优化（并发控制）
- [ ] 更多平台下载器（B 站/抖音/微博）
- [ ] 视频指纹去重（帧 pHash）
- [ ] 进度追踪（异步任务）

---

## 环境配置

**新增环境变量** (`.env`):

```bash
# 下载器配置
DOWNLOAD_TEMP_DIR=/tmp/annsight-downloads
UPLOAD_TEMP_DIR=/tmp/annsight-uploads

# Whisper 配置（二选一）
# 方式 1: API 调用
OPENCLAW_WHISPER_URL=http://localhost:8000/v1/audio/transcriptions
OPENCLAW_WHISPER_TOKEN=your-token

# 方式 2: 本地 CLI
WHISPER_MODEL=base
WHISPER_DEVICE=cpu

# OCR 配置
OCR_ENGINE=tesseract  # 或 aliyun_ocr

# 阿里云 OCR（如使用）
ALIYUN_ACCESS_KEY_ID=xxx
ALIYUN_ACCESS_KEY_SECRET=xxx

# Playwright 配置
PLAYWRIGHT_BROWSER=chromium
PLAYWRIGHT_HEADLESS=true
```

---

## 使用示例

### 1. 上传 URL 链接

```bash
curl -X POST http://localhost:3000/api/raw-data/upload \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.zhihu.com/question/123456",
      "https://www.xiaohongshu.com/explore/abc"
    ],
    "batchId": "batch-001",
    "source": "zhihu",
    "purposes": ["rag", "finetuning"]
  }'
```

### 2. 前端使用

1. 打开 http://localhost:3000/raw-data.html
2. 点击 "🔗 链接上传" 标签页
3. 输入多个 URL（每行一个）
4. 选择数据来源平台
5. 输入批次 ID
6. （可选）启用裂变配置
7. 点击 "上传并处理"

---

## 技术亮点

1. **策略模式** - 下载器和提取器采用策略模式，易于扩展新平台
2. **统一接口** - 所有提取器输出标准化格式 `{ text, metadata }`
3. **自动路由** - ContentRouter 自动识别内容类型并分发
4. **JSONPath 支持** - 灵活的 JSON 字段提取配置
5. **多 OCR 引擎** - 支持 Tesseract.js 和阿里云 OCR
6. **Whisper 集成** - 支持 API 和 CLI 两种调用方式

---

## 测试建议

1. **单元测试** - 测试每个提取器的核心逻辑
2. **集成测试** - 测试完整的 URL 上传流程
3. **UAT 测试** - 端到端验证（Playwright）
4. **性能测试** - 批量 URL 并发处理

---

## 相关文档

- 原计划文档：`/home/admin/claude-code-projects/annsight-data-manager/MEMORY.md`
- 下载器架构参考：`/home/admin/projects/xiaohongshu-manager/backend/services/downloaders/`
- ETL 管道实现：`src/pipeline/data-pipeline.js`
