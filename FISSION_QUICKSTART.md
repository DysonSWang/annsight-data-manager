# AnnSight 裂变功能快速参考

## 🚀 快速开始

### 什么是裂变？

裂变 = 1 条源数据 → N 条不同用途的加工数据

**示例**:
```
1 条 JSONL 对话数据
  ↓ 裂变
→ 3 条 RAG 知识点 (用于知识库)
→ 2 条微调对话 (用于模型训练)
→ 2 条创作素材 (用于内容生成)
```

---

## 📋 配置模式

### 模式 1: 无配置（默认）

```javascript
const result = await etlService.processText(text, {
  purposes: ['rag', 'finetuning', 'content_creation']
});

// 结果：每种用途生成 1 条，共 3 条
```

**适用场景**: 快速测试、简单数据

---

### 模式 2: 带配置（推荐）

```javascript
const result = await etlService.processText(text, {
  purposes: ['rag', 'finetuning'],
  fissionConfig: {
    rag: { count: 3, requirement: '需要包含具体案例和步骤' },
    finetuning: { count: 2, requirement: '对话需要自然流畅' }
  }
});

// 结果：3 条 RAG + 2 条微调 = 5 条
```

**适用场景**: 生产环境、精确控制

---

### 模式 3: 对话数据专用

```javascript
const result = await etlService.processText(text, {
  purposes: ['finetuning'],
  conversation: [
    { role: 'user', content: '问题' },
    { role: 'assistant', content: '回答' }
  ],
  fissionConfig: {
    finetuning: { count: 2 }
  }
});

// 结果：2 条保留原始对话结构的微调数据
```

**适用场景**: 微调数据生成

---

## 📊 裂变倍率参考

| 配置 | 裂变倍率 | 输出示例 |
|------|----------|----------|
| 单用途 | 1x | 1 条 RAG 数据 |
| 双用途 | 2x | RAG + 微调 |
| 三用途 | 3x | RAG + 微调 + 创作 |
| 配置增强 | 2-10x | 按配置 count 值 |

**推荐配置**:
- RAG 知识库：每条源数据生成 2-3 条
- 微调数据：每条源数据生成 1-2 条
- 内容素材：每条源数据生成 1-2 条

---

## 🔧 支持的用途

| 用途 | 说明 | 输出格式 |
|------|------|----------|
| `rag` | RAG 知识库 | 知识点、案例、技巧 |
| `finetuning` | 微调数据 | 多轮对话、问答对 |
| `content_creation` | 内容素材 | 选题、大纲、片段 |
| `other` | 其他用途 | 自定义格式 |

---

## 💻 代码示例

### 基础用法

```javascript
const { EtlService } = require('./src/pipeline/etl-service');
const etlService = new EtlService(pool);

// 处理文本（启用裂变）
const result = await etlService.processText('源文本内容', {
  purposes: ['rag', 'finetuning']
});

console.log(`生成 ${result.fissionCount} 条数据`);
console.log('数据 ID:', result.processedDataIds);
```

### 高级用法

```javascript
const result = await etlService.processText('源文本内容', {
  source: 'jsonl_import',
  batchId: 'batch-001',
  purposes: ['rag', 'finetuning', 'content_creation'],
  fissionConfig: {
    rag: {
      count: 3,
      requirement: '需要包含具体案例和步骤，适合职场沟通场景'
    },
    finetuning: {
      count: 2,
      requirement: '对话需要自然流畅，保留原始语气'
    },
    content_creation: {
      count: 2,
      requirement: '素材需要可复用，适合公众号文章'
    }
  }
});

// 结果处理
if (result.success) {
  console.log(`成功生成 ${result.fissionCount} 条数据`);

  // 每条数据都可以单独使用
  result.processedDataIds.forEach((id, idx) => {
    console.log(`数据 ${idx + 1}: ${id}`);
  });
}
```

### JSONL 文件批量处理

```javascript
const { JsonlExtractor } = require('./src/services/extractors/jsonl-extractor');
const extractor = new JsonlExtractor();

// 1. 提取 JSONL 文件
const extractResult = await extractor.extract('data.jsonl');

// 2. 逐条裂变处理
for (const item of extractResult.items) {
  const result = await etlService.processText(item.text, {
    purposes: ['finetuning'],
    conversation: item.conversation,
    fissionConfig: {
      finetuning: { count: 2 }
    }
  });

  console.log(`处理第 ${item.lineNumber} 条：生成 ${result.fissionCount} 条`);
}
```

---

## 📁 文件位置

| 类型 | 路径 |
|------|------|
| 裂变处理器 | `src/pipeline/processors/l25-fission.js` |
| ETL 服务 | `src/pipeline/etl-service.js` |
| 测试脚本 | `tests/uat/v4/test-jsonl-fission.js` |
| 测试报告 | `tests/uat/v4/FISSION_TEST_REPORT.md` |

---

## 🧪 运行测试

```bash
# 裂变功能测试
node tests/uat/v4/test-jsonl-fission.js

# 预期输出:
# ✅ 无配置裂变：3 条
# ✅ 带配置裂变：8 条
# ✅ 对话数据裂变：2 条
# ✅ 批量裂变：40 条 (10 条源数据)
```

---

## ⚠️ 注意事项

1. **裂变数量**: 建议每用途 1-5 条，过多会产生大量重复
2. **去重检测**: 裂变后建议进行去重检测
3. **冷却期**: AI 生成的数据需要设置冷却期（默认 24 小时）
4. **LLM 依赖**: 生产环境需要配置真实的 LLM API

---

## 🔗 相关文档

- **详细测试报告**: `tests/uat/v4/FISSION_TEST_REPORT.md`
- **JSONL 导入**: `tests/uat/v4/JSONL_IMPORT_COMPLETE.md`
- **快速开始**: `JSONL_QUICKSTART.md`

---

**更新日期**: 2026-03-22
**版本**: v4.0
