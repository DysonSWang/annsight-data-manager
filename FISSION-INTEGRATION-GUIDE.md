# AnnSight 裂变功能集成指南

**版本**: v1.0
**更新日期**: 2026-03-22
**状态**: ✅ 已完成集成

---

## 📋 目录

1. [流程概述](#流程概述)
2. [架构图](#架构图)
3. [配置说明](#配置说明)
4. [使用示例](#使用示例)
5. [故障排除](#故障排除)

---

## 流程概述

### 传统流程（无裂变）

```
源数据 → L1 清洗 → L2 结构化 → L3 评估 → 去重 → 1 条加工数据
```

### 裂变流程（启用多用途）

```
源数据 → L1 清洗 → L2.5 裂变 → L2 结构化 → L3 评估 → 去重 → N 条加工数据
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
              RAG 素材 (3 条)   微调数据 (2 条)   内容创作 (2 条)
```

---

## 架构图

### 数据流

```
┌─────────────────────────────────────────────────────────┐
│ 1. 前端上传页面                                          │
│    - 选择裂变方向：☑ RAG ☑ 微调 ☐ 内容创作              │
│    - 上传文件/文本                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. API 层 (raw-data.js)                                  │
│    POST /api/raw-data/batch-text                        │
│    - 接收 purposes 参数：['rag', 'finetuning']           │
│    - 传递给 ETL Service                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. ETL Service (etl-service.js)                         │
│    - 根据 purposes 存在决定启用 'fission' Pipeline       │
│    - processText(text, { purposes: ['rag', 'finetuning'] }) │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Pipeline (data-pipeline.js)                          │
│    - 使用 'fission' 配置                                │
│    - steps: [l1-clean, l25-fission, l2-structure,       │
│              l3-evaluate, dedup]                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 5. 处理器执行顺序                                        │
│    ┌─────────────────────────────────────────────┐     │
│    │ L1: 清洗文本                                 │     │
│    │    input: 原始文本                          │     │
│    │    output: cleanedText                      │     │
│    └─────────────────────────────────────────────┘     │
│                          ↓                               │
│    ┌─────────────────────────────────────────────┐     │
│    │ L2.5: 裂变 (启用时)                          │     │
│    │    input: cleanedText + purposes            │     │
│    │    output: items[{type, category, title,   │     │
│    │            content, purposes, tags, ...}]   │     │
│    └─────────────────────────────────────────────┘     │
│                          ↓                               │
│    ┌─────────────────────────────────────────────┐     │
│    │ L2: 结构化                                   │     │
│    │    裂变模式：直接使用 items，补充字段       │     │
│    │    传统模式：LLM 分析生成结构化数据          │     │
│    └─────────────────────────────────────────────┘     │
│                          ↓                               │
│    ┌─────────────────────────────────────────────┐     │
│    │ L3: 评估                                     │     │
│    │    裂变模式：补充质量评分                   │     │
│    │    传统模式：计算 completeness/authenticity │     │
│    └─────────────────────────────────────────────┘     │
│                          ↓                               │
│    ┌─────────────────────────────────────────────┐     │
│    │ Dedup: 去重                                  │     │
│    │    裂变模式：对每条 item 去重                │     │
│    │    传统模式：MD5/LSH 去重                    │     │
│    └─────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 6. ETL Service 保存                                      │
│    saveProcessedData({ items: [...], purposes: [...] }) │
│    - 遍历 items 数组                                    │
│    - 每条调用 _saveSingleProcessedData()                │
│    - 返回 processedDataIds 数组                         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 7. 数据库存储                                            │
│    processed_data 表：                                  │
│    - pd-xxx-001 (purposes: 'rag')                       │
│    - pd-xxx-002 (purposes: 'finetuning')                │
│    - pd-xxx-003 (purposes: 'rag,finetuning')            │
└─────────────────────────────────────────────────────────┘
```

---

## 配置说明

### Pipeline 配置

**文件**: `src/pipeline/data-pipeline.js`

```javascript
// 裂变模式配置
const PIPELINE_PRESETS = {
    fission: {
        name: 'fission',
        description: '多用途裂变处理流程',
        steps: [
            { name: 'l1-clean', enabled: true, required: true },
            { name: 'l25-fission', enabled: true, required: false },
            { name: 'l2-structure', enabled: true, required: true },
            { name: 'l3-evaluate', enabled: true, required: true },
            { name: 'dedup', enabled: true, required: true }
        ]
    }
};
```

### 处理器注册

**文件**: `src/pipeline/processors/index.js`

```javascript
const { L25FissionProcessor } = require('./l25-fission');

function createDefaultProcessors(options = {}) {
    const fissionOptions = {
        purposes: options.purposes || ['rag', 'finetuning', 'content_creation']
    };

    return {
        'l1-clean': new L1CleanProcessor(),
        'l25-fission': new L25FissionProcessor(llmFissionService, fissionOptions),
        // ... 其他处理器
    };
}
```

### 用途字段

**数据库字段**: `processed_data.purposes`

存储格式：逗号分隔的字符串
- `'rag'` - 仅用于 RAG
- `'rag,finetuning'` - 用于 RAG 和微调
- `'finetuning,content_creation'` - 用于微调和内容创作

---

## 使用示例

### 示例 1：前端上传（完整裂变）

```javascript
// 1. 前端选择所有用途
const purposes = ['rag', 'finetuning', 'content_creation'];

// 2. 调用 API
fetch('/api/raw-data/batch-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        texts: ['职场沟通中，学会倾听很重要...'],
        batchId: 'zhihu-2026-03-22',
        source: 'zhihu',
        purposes: purposes
    })
});

// 3. 返回结果
{
    "success": true,
    "total": 1,
    "successCount": 1,
    "totalFissionCount": 5,  // 裂变出 5 条数据
    "results": [{
        "success": true,
        "processedDataIds": [
            "pd-1711123456-abc123",  // RAG 素材
            "pd-1711123457-def456",  // 微调数据
            "pd-1711123458-ghi789",  // RAG 素材
            "pd-1711123459-jkl012",  // 微调数据
            "pd-1711123460-mno345"   // 内容创作
        ],
        "fissionCount": 5
    }]
}
```

### 示例 2：仅 RAG 素材

```javascript
// 只勾选 RAG 用途
const purposes = ['rag'];

// API 调用同上
// 返回结果中所有数据的 purposes 都是 'rag'
```

### 示例 3：统计看板筛选

```javascript
// 访问统计看板
GET /api/review/stats/summary?purposes=rag,finetuning

// 返回结果（仅统计 RAG 和微调数据）
{
    "pending": 10,
    "approved": 50,
    "rejected": 2,
    "accuracy": 85.5
}
```

---

## 代码示例

### 自定义 LLM 提示词

```javascript
// 替换 src/pipeline/processors/l25-fission.js 中的 MockLlmServiceForFission

class RealLlmService {
    constructor(apiKey, model) {
        this.apiKey = apiKey;
        this.model = model;
    }

    async analyzeForFission(text, options = {}) {
        const { purposes = ['rag'], sourceType = 'unknown' } = options;

        const prompt = this.buildFissionPrompt(text, purposes, sourceType);

        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 4000
            })
        });

        const data = await response.json();
        const content = data.choices[0].message.content;

        // 解析 JSON 响应
        try {
            const result = JSON.parse(content);
            return { items: result.items || [] };
        } catch (e) {
            console.error('解析 LLM 响应失败:', e);
            return { items: [] };
        }
    }

    buildFissionPrompt(text, purposes, sourceType) {
        const purposeText = purposes.join(',');

        return `
你是一个专业的数据分析师，负责将原始文本裂变成多条不同用途的高质量数据。

## 输入文本
${text}

## 任务要求

请分析上述文本，根据内容特点裂变成多条数据，每条数据标注其用途：
${purposes.includes('rag') ? '1. **RAG 素材** (rag)：提取独立的知识点、案例、技巧' : ''}
${purposes.includes('finetuning') ? '2. **微调数据** (finetuning)：生成多轮对话或问答对' : ''}
${purposes.includes('content_creation') ? '3. **内容创作素材** (content_creation)：提取创作选题、大纲、素材片段' : ''}

## 输出格式

\`\`\`json
{
  "items": [
    {
      "type": "知识卡片 | 教训案例 | 战术方法 | 沟通技巧 | 多轮对话 | 创作素材",
      "category": "职场 | 情感 | 家庭 | 社交 | 学习 | 自我",
      "title": "简洁的标题（≤50 字）",
      "content": "内容主体",
      "purposes": ["${purposeText.split(',')[0]}"],
      "tags": ["标签 1", "标签 2"],
      "aiConfidenceScore": 0.92
    }
  ]
}
\`\`\`

请严格按照 JSON 格式输出。
        `;
    }
}
```

### 集成真实 LLM

```javascript
// src/pipeline/processors/index.js

const { RealLlmService } = require('../services/real-llm-service');

function createDefaultProcessors(options = {}) {
    // 使用真实 LLM 服务
    const llmService = new RealLlmService(
        process.env.DEEPSEEK_API_KEY,
        'deepseek-chat'
    );

    const fissionOptions = {
        purposes: options.purposes || ['rag', 'finetuning', 'content_creation']
    };

    return {
        'l1-clean': new L1CleanProcessor(),
        'l25-fission': new L25FissionProcessor(llmService, fissionOptions),
        'l2-structure': new L2StructureProcessor(llmService),
        'l3-evaluate': new L3EvaluateProcessor(),
        'dedup': new DedupProcessor(dedupOptions)
    };
}
```

---

## 故障排除

### 问题 1：裂变未生效

**现象**：上传后只生成 1 条数据，没有裂变

**检查步骤**：
1. 检查前端是否勾选了用途
2. 检查 API 请求是否传递了 `purposes` 参数
3. 检查 `etl-service.js` 的 `processText` 方法是否选择 `fission` 配置
4. 检查 Pipeline 配置中 `l25-fission` 步骤是否 `enabled: true`

### 问题 2：items 数组为空

**现象**：裂变了但返回空数组

**检查步骤**：
1. 检查 LLM 服务是否正确配置
2. 检查 LLM 提示词是否正确
3. 检查 LLM 响应格式是否为 JSON
4. 查看日志输出：`[L2.5] 裂变结果`

### 问题 3：purposes 字段未保存

**现象**：数据库中 purposes 字段为空

**检查步骤**：
1. 检查 `ProcessedDataRepository.create()` 是否接收 purposes 参数
2. 检查 SQL INSERT 语句是否包含 purposes 字段
3. 检查数据库迁移是否执行（002-add-purpose-column.sql）

### 问题 4：统计筛选不生效

**现象**：统计看板勾选用途后数据不变

**检查步骤**：
1. 检查前端 `getSelectedPurposes()` 函数
2. 检查 API 请求 URL 是否包含 `?purposes=rag,finetuning`
3. 检查后端 `getDistribution(field, purposesFilter)` 是否正确处理筛选

---

## 下一步优化

1. **LLM 集成**: 替换 Mock 服务为真实 LLM API
2. **提示词优化**: 根据实际效果调整裂变提示词
3. **性能优化**: 大批量裂变的异步队列处理
4. **监控告警**: 裂变系数监控（过高/过低告警）
5. **质量评分**: 裂变大模型输出质量评估

---

**集成完成！可以开始使用裂变功能了。**
