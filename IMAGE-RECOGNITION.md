# AnnSight 图片识别功能说明

**日期**: 2026-03-22
**版本**: v4.0

---

## 📋 概述

AnnSight v4.0 支持三种图片识别模式，可以根据需求选择合适的方案：

| 模式 | 技术 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| **OCR** | Tesseract.js | 本地运行，免费 | 中文准确率有限 | 文档截图、清晰文字 |
| **OCR** | 阿里云 OCR | 准确率高 | 付费 | 复杂场景、手写体 |
| **AI 视觉** | 视觉大模型 | 理解场景 + 文字 | 需要 API | 复杂图片、场景理解 |
| **混合** | OCR + AI 视觉 | 最完整 | 成本最高 | 关键任务 |

---

## 🔧 配置方式

### 方式 1: 本地 OCR (Tesseract.js)

**优点**:
- ✅ 无需 API 密钥
- ✅ 完全免费
- ✅ 本地处理，数据私密

**缺点**:
- ⚠️ 中文识别准确率约 70-80%
- ⚠️ 对模糊图片效果差

**配置**:
```bash
# .env
OCR_ENGINE=tesseract
```

**使用**:
```javascript
const { ImageExtractor } = require('./src/services/extractors/image-extractor');
const extractor = new ImageExtractor();

const result = await extractor.extract('image.jpg', {
    engine: 'tesseract'
});

console.log(result.text); // OCR 识别的文字
```

---

### 方式 2: 阿里云 OCR

**优点**:
- ✅ 中文准确率 95%+
- ✅ 支持多种语言
- ✅ 支持手写体

**缺点**:
- ⚠️ 需要付费
- ⚠️ 需要配置 API 密钥

**配置**:
```bash
# .env
OCR_ENGINE=aliyun_ocr
ALIYUN_ACCESS_KEY_ID=your-key-id
ALIYUN_ACCESS_KEY_SECRET=your-key-secret
```

**使用**:
```javascript
const { ImageExtractor } = require('./src/services/extractors/image-extractor');
const extractor = new ImageExtractor();

const result = await extractor.extract('image.jpg', {
    engine: 'aliyun'
});

console.log(result.text); // OCR 识别的文字
```

---

### 方式 3: AI 视觉模型 (新增)

**优点**:
- ✅ 理解图片场景
- ✅ 提取文字 + 描述内容
- ✅ 可以回答关于图片的问题

**缺点**:
- ⚠️ 需要视觉 API
- ⚠️ 处理时间较长

**支持的视觉 API**:
1. OpenClaw Vision API
2. Anthropic Claude (视觉模型)
3. 其他兼容的视觉 API

**配置**:
```bash
# .env
# 方式 1: OpenClaw Vision API
OPENCLAW_VISION_URL=http://localhost:8000/v1/vision
OPENCLAW_VISION_TOKEN=your-token

# 方式 2: Anthropic Claude
ANTHROPIC_API_KEY=sk-xxx
```

**使用**:
```javascript
const { AIVisionExtractor } = require('./src/services/extractors/ai-vision-extractor');
const extractor = new AIVisionExtractor();

// 混合模式：OCR + 视觉理解
const result = await extractor.extract('image.jpg', {
    mode: 'hybrid',  // 'ocr', 'vision', 'hybrid'
    prompt: '请描述这张图片并提取其中的所有文字'
});

console.log('OCR 文字:', result.text);
console.log('视觉描述:', result.metadata);
```

---

## 📁 使用示例

### 1. 前端上传图片

打开 `http://localhost:3000/raw-data.html`

1. 点击 "📁 文件上传" 标签页
2. 选择或拖拽图片文件（JPG/PNG）
3. 输入批次 ID
4. 点击 "上传并处理"

系统会自动：
- 检测图片类型
- 调用 OCR 或 AI 视觉提取文字
- 进入 ETL 处理流程

### 2. API 上传

```bash
curl -X POST http://localhost:3000/api/raw-data/upload \
  -F "file=@image.jpg" \
  -F "batchId=batch-001" \
  -F "source=submission" \
  -F "imageMode=hybrid"
```

### 3. 代码调用

```javascript
const { ContentRouter } = require('./src/services/content-router');

// 创建路由（配置图片识别模式）
const router = new ContentRouter({
    imageMode: 'hybrid'  // 'ocr', 'vision', 'hybrid'
});

// 处理图片
const result = await router.route({
    type: 'file',
    path: 'image.jpg'
}, {
    // OCR 配置
    ocrEngine: 'tesseract',

    // AI 视觉配置
    visionPrompt: '请详细描述这张图片的内容，并提取其中的所有文字'
});

console.log('提取的文字:', result.text);
console.log('元数据:', result.metadata);
```

---

## 🧪 测试图片识别

### 测试脚本

```bash
node tests/uat/v4/test-multi-format.js
```

### 测试用例

```javascript
const { ImageExtractor } = require('./src/services/extractors/image-extractor');
const { AIVisionExtractor } = require('./src/services/extractors/ai-vision-extractor');

// 测试 OCR
async function testOCR() {
    const extractor = new ImageExtractor();
    const result = await extractor.extract('test-ocr.jpg');
    console.log('OCR 结果:', result.text);
}

// 测试 AI 视觉
async function testVision() {
    const extractor = new AIVisionExtractor();
    const result = await extractor.extract('test-image.jpg', {
        mode: 'hybrid'
    });
    console.log('视觉结果:', result.text);
}
```

---

## 🎯 推荐配置

### 个人开发/测试
```bash
OCR_ENGINE=tesseract
# 免费，本地运行
```

### 生产环境（高准确率需求）
```bash
OCR_ENGINE=aliyun_ocr
ALIYUN_ACCESS_KEY_ID=xxx
ALIYUN_ACCESS_KEY_SECRET=xxx
# 阿里云 OCR，准确率 95%+
```

### 复杂场景理解
```bash
OCR_ENGINE=tesseract
OPENCLAW_VISION_URL=http://localhost:8000/v1/vision
OPENCLAW_VISION_TOKEN=xxx
# OCR + AI 视觉混合模式
```

---

## 📊 性能对比

| 方案 | 准确率 | 速度 | 成本 |
|------|--------|------|------|
| Tesseract.js | 70-80% | 快 (1-5s) | 免费 |
| 阿里云 OCR | 95%+ | 快 (0.5-2s) | ¥0.005/张 |
| AI 视觉 | 90%+ | 中 (5-15s) | 按 token 计费 |
| 混合模式 | 98%+ | 慢 (10-20s) | 两者之和 |

---

## ⚠️ 注意事项

1. **图片大小**: 建议不超过 10MB，过大会导致 OCR 慢或失败
2. **图片格式**: 支持 JPG/PNG/GIF/WEBP/BMP
3. **文字方向**: 横排文字识别效果最好，竖排可能不准确
4. **模糊图片**: 模糊或低分辨率图片识别率会下降
5. **手写体**: Tesseract 对手写体识别效果差，建议用阿里云 OCR

---

## 🔮 未来计划

- [ ] 支持更多 OCR 引擎（百度 OCR、腾讯 OCR）
- [ ] 批量图片处理优化
- [ ] 图片预处理（去噪、增强）
- [ ] 表格图片结构化提取
- [ ] 公式识别（LaTeX 输出）
