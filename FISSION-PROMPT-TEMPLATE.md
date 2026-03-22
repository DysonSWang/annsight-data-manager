# AnnSight 多用途裂变提示词模板

**版本**: v1.1
**更新日期**: 2026-03-22
**状态**: ✅ 前端已支持

---

## 📋 目录

1. [概述](#概述)
2. [数据结构](#数据结构)
3. [提示词模板](#提示词模板)
4. [使用示例](#使用示例)
5. [前端使用](#前端使用)
6. [自定义提示词](#自定义提示词)

---

## 概述

### 裂变效果

一条源数据（种子）可以裂变成多条不同用途的加工数据：

```
源数据（种子）
    │
    ├──→ RAG 素材（知识库文档）
    ├──→ 微调数据（SFT 训练样本）
    └──→ 内容创作素材（选题/大纲）
```

### 支持的用途

| 用途代码 | 说明 | 输出格式 |
|---------|------|---------|
| `rag` | RAG 知识库素材 | 知识点、案例、技巧卡片 |
| `finetuning` | 微调训练数据 | 多轮对话、问答对 |
| `content_creation` | 内容创作素材 | 选题、大纲、素材片段 |

---

## 数据结构

### 输出格式

LLM 需要返回 JSON 格式，包含 `items` 数组：

```json
{
  "items": [
    {
      "type": "知识卡片",
      "category": "职场",
      "title": "倾听的五个层次",
      "content": "...',
      "purposes": ["rag"],
      "tags": ["倾听", "沟通"],
      "aiConfidenceScore": 0.92
    },
    {
      "type": "多轮对话",
      "category": "职场",
      "title": "如何提高倾听能力",
      "content": "...',
      "purposes": ["finetuning"],
      "conversation": [
        {"role": "user", "content": "如何提高倾听能力？"},
        {"role": "assistant", "content": "..."}
      ],
      "tags": ["对话", "倾听"],
      "aiConfidenceScore": 0.88
    },
    {
      "type": "创作素材",
      "category": "通用",
      "title": "倾听主题素材",
      "content": "...',
      "purposes": ["content_creation"],
      "tags": ["素材", "倾听"],
      "aiConfidenceScore": 0.85
    }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `type` | ✅ | 类型：知识卡片/教训案例/战术方法/沟通技巧/多轮对话/创作素材 |
| `category` | ✅ | 分类：职场/情感/家庭/社交/学习/自我 |
| `title` | ✅ | 标题（≤50 字） |
| `content` | ✅ | 内容主体（RAG 素材 200-2000 字，微调数据 50-500 字） |
| `purposes` | ✅ | 用途数组：`["rag"]` 或 `["finetuning"]` 或 `["content_creation"]` |
| `tags` | ❌ | 标签数组 |
| `aiConfidenceScore` | ❌ | AI 置信度 0.0-1.0 |
| `conversation` | 条件 | 当 `purposes` 包含`finetuning`时必填 |

---

## 提示词模板

### 模板 1：完整裂变（支持三用途）

```
你是一个专业的数据分析师，负责将原始文本裂变成多条不同用途的高质量数据。

## 输入文本
{{{input_text}}}

## 任务要求

请分析上述文本，根据内容特点裂变成多条数据，每条数据标注其用途：

1. **RAG 素材** (`rag`)：提取独立的知识点、案例、技巧，用于 RAG 知识库检索
2. **微调数据** (`finetuning`)：生成多轮对话或问答对，用于模型 SFT 微调
3. **内容创作素材** (`content_creation`)：提取创作选题、大纲、素材片段

## 输出格式

```json
{
  "items": [
    {
      "type": "知识卡片 | 教训案例 | 战术方法 | 沟通技巧 | 多轮对话 | 创作素材",
      "category": "职场 | 情感 | 家庭 | 社交 | 学习 | 自我",
      "title": "简洁的标题（≤50 字）",
      "content": "内容主体",
      "purposes": ["rag"],
      "tags": ["标签 1", "标签 2"],
      "aiConfidenceScore": 0.92
    },
    {
      "type": "多轮对话",
      "category": "职场",
      "title": "对话标题",
      "content": "对话摘要",
      "purposes": ["finetuning"],
      "conversation": [
        {"role": "user", "content": "用户问题"},
        {"role": "assistant", "content": "助手回答"}
      ],
      "tags": ["标签"],
      "aiConfidenceScore": 0.88
    }
  ]
}
```

## 注意事项

1. 每条数据只标注一个主要用途
2. 同一内容不要同时标注多个用途
3. RAG 素材注重独立性和完整性
4. 微调数据注重对话自然和实用性
5. 内容创作素材注重启发性和扩展性

请严格按照 JSON 格式输出，不要包含其他文字。
```

---

### 模板 2：仅 RAG 素材

```
你是一个专业的知识库构建专家，负责从原始文本中提取高质量的 RAG 知识点。

## 输入文本
{{{input_text}}}

## 任务要求

从上述文本中提取所有独立的知识点，每个知识点应该：
1. 有明确的的主题和完整的内容
2. 可以独立存在，不依赖上下文
3. 适合用于 RAG 知识库检索

## 输出格式

```json
{
  "items": [
    {
      "type": "知识卡片 | 教训案例 | 战术方法 | 沟通技巧",
      "category": "职场 | 情感 | 家庭 | 社交 | 学习 | 自我",
      "title": "知识点标题（≤50 字）",
      "content": "知识点详细内容（200-2000 字）",
      "purposes": ["rag"],
      "tags": ["标签 1", "标签 2"],
      "aiConfidenceScore": 0.90
    }
  ]
}
```

请严格按照 JSON 格式输出。
```

---

### 模板 3：仅微调数据

```
你是一个专业的对话数据生成专家，负责从原始文本中生成高质量的 SFT 微调数据。

## 输入文本
{{{input_text}}}

## 任务要求

基于上述文本，生成多轮对话样本，要求：
1. 对话自然流畅，符合真实场景
2. 用户问题明确，助手回答有用
3. 每轮对话有明确的场景和目的

## 输出格式

```json
{
  "items": [
    {
      "type": "多轮对话",
      "category": "职场 | 情感 | 家庭 | 社交 | 学习 | 自我",
      "title": "对话场景描述",
      "content": "对话摘要（50-100 字）",
      "purposes": ["finetuning"],
      "conversation": [
        {"role": "user", "content": "用户的第一轮问题"},
        {"role": "assistant", "content": "助手的回答"},
        {"role": "user", "content": "用户的追问"},
        {"role": "assistant", "content": "助手的进一步回答"}
      ],
      "tags": ["标签"],
      "aiConfidenceScore": 0.88
    }
  ]
}
```

对话轮数：2-6 轮
请严格按照 JSON 格式输出。
```

---

### 模板 4：仅内容创作素材

```
你是一个专业的内容创作助手，负责从原始文本中提取创作素材。

## 输入文本
{{{input_text}}}

## 任务要求

从上述文本中提取可用于内容创作的素材，包括：
1. 选题方向：可以扩展的主题
2. 大纲框架：文章/课程的结构
3. 素材片段：名言、案例、数据、金句

## 输出格式

```json
{
  "items": [
    {
      "type": "创作素材",
      "category": "职场 | 情感 | 家庭 | 社交 | 学习 | 自我",
      "title": "素材主题",
      "content": "素材详细内容",
      "purposes": ["content_creation"],
      "tags": ["素材", "标签"],
      "aiConfidenceScore": 0.85
    }
  ]
}
```

请严格按照 JSON 格式输出。
```

---

## 前端使用

### 1. 上传页面选择用途

访问 **源数据管理** 页面 (`http://localhost:3000/raw-data.html`)，点击 **"批量上传"** 按钮。

在上传弹窗中，可以看到 **"裂变方向（多选）"** 选项：

```
┌─────────────────────────────────────────┐
│  裂变方向（多选）                         │
│  ☑ 📚 RAG 素材                           │
│  ☑ 🤖 微调数据                           │
│  ☐ ✍️ 内容创作素材                       │
└─────────────────────────────────────────┘
```

**说明**：
- ☑ 勾选表示启用该用途方向
- 默认勾选 RAG 和微调数据
- 可多选，系统将按选择的方向进行裂变

### 2. 统计看板按用途筛选

访问 **统计看板** 页面 (`http://localhost:3000/stats.html`)，顶部有用途筛选器：

```
┌─────────────────────────────────────────────────────────┐
│ 📌 按用途筛选：☑ 📚 RAG 素材  ☑ 🤖 微调数据  ☑ ✍️ 内容创作 │
└─────────────────────────────────────────────────────────┘
```

**说明**：
- 取消勾选某个用途后，统计数据将排除该用途的数据
- 可用于查看特定用途的数据分布情况
- 实时刷新，自动更新图表

### 3. 上传结果展示

上传完成后，Toast 提示会显示裂变效果：

```
上传完成：成功 10/10（裂变 35 条加工数据）
                          ↑
                    裂变后的总数
```

---

## 使用示例

### 示例 1：知乎文章裂变

**输入**：一篇关于"职场沟通"的知乎文章（3000 字）

**提示词**：使用模板 1（完整裂变）

**预期输出**：
- 5 条 RAG 知识点（倾听技巧、反馈方法等）
- 3 条微调对话（职场沟通场景）
- 2 条创作素材（选题方向）

**裂变系数**：10x

---

### 示例 2：访谈录音转录

**输入**：访谈录音转录文本（5000 字）

**提示词**：使用模板 1（完整裂变）

**预期输出**：
- 8 条 RAG 案例（真实教训案例）
- 4 条微调对话（咨询场景）
- 3 条创作素材（金句、故事）

**裂变系数**：15x

---

### 示例 3：小红书笔记

**输入**：小红书情感笔记（800 字）

**提示词**：使用模板 2（仅 RAG）

**预期输出**：
- 2 条 RAG 知识点（情感技巧）

**裂变系数**：2x

---

## 自定义提示词

### 替换 LLM 服务

在 `src/pipeline/processors/l25-fission.js` 中：

```javascript
// 当前使用 Mock 服务
const fissionResult = await this.llmService.analyzeForFission(cleanedText, {
    purposes,
    sourceType
});

// 替换为真实 LLM 调用
const fissionResult = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{
            role: 'user',
            content: prompt.replace('{{{input_text}}}', cleanedText)
        }]
    })
}).then(res => res.json());
```

### 配置用途

在 Pipeline 配置中设置支持的用途：

```javascript
const fissionProcessor = new L25FissionProcessor(llmService, {
    purposes: ['rag', 'finetuning'] // 只支持 RAG 和微调
});

pipeline.addStep('fission', fissionProcessor);
```

---

## 配置文件

### `config/fission-config.json`

```json
{
  "defaultPurposes": ["rag", "finetuning", "content_creation"],
  "llmProvider": "deepseek",
  "apiKey": "${DEEPSEEK_API_KEY}",
  "model": "deepseek-chat",
  "temperature": 0.7,
  "maxTokens": 4000,
  "promptTemplate": "templates/fission-prompt-v1.txt"
}
```

---

## 集成到现有流程

### 修改 `src/pipeline/processors/index.js`

```javascript
const { L25FissionProcessor } = require('./l25-fission');

function createDefaultProcessors(options) {
    return {
        // ... 其他处理器
        fission: new L25FissionProcessor(llmService, {
            purposes: options.purposes
        })
    };
}
```

### 修改 `src/pipeline/data-pipeline.js`

```javascript
// 添加裂变步骤
pipeline.addStep('l1-clean', l1CleanProcessor);
pipeline.addStep('l25-fission', fissionProcessor); // 新增
pipeline.addStep('l2-structure', l2StructureProcessor);
pipeline.addStep('l3-evaluate', l3EvaluateProcessor);
```

---

## 验收标准

| 指标 | 目标 |
|------|------|
| 裂变系数 | ≥3x（1 条源数据→≥3 条加工数据） |
| JSON 格式正确率 | ≥95% |
| 用途标注准确率 | ≥90% |
| 内容质量通过率 | ≥85%（人工抽检） |

---

**提示词模板已完成，后续可以根据实际效果调整优化！**
