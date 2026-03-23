# SFT 格式导出指南

## 概述

本系统支持将已审核通过的数据导出为 **SFT（Supervised Fine-Tuning）格式**，用于大语言模型的微调训练。导出格式包含 `<think>` 思考标签，符合阿里百炼等主流微调平台的数据格式要求。

---

## 导出格式

### 目标格式（JSONL）

每条数据为一行 JSON，包含完整的对话流程：

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "问题内容"},
    {"role": "assistant", "content": "<think>\n思考分析过程\n</think>\n\n实际回复内容"}
  ],
  "metadata": {
    "id": "pd-xxx",
    "type": "类型",
    "category": "分类",
    "subcategory": "子分类",
    "source": "来源",
    "batch_id": "批次 ID"
  }
}
```

### `<think>` 思考标签说明

系统会根据数据类型自动生成不同的思考模板：

| 数据类型 | 思考模板内容 |
|---------|-------------|
| 教训案例 | 分析用户问题类型，识别这是一个经验教训类的询问。需要从案例中提取关键教训点。组织回答结构：先点明主题，再分条列出教训，最后总结。确保语言简洁、实用，避免空泛说教。 |
| 战术方法 | 理解用户需求，这是一个寻求具体方法的询问。梳理方法步骤，确保逻辑清晰、可操作性强。考虑用户可能的应用场景，提供针对性的建议。检查回答是否完整覆盖了问题要点。 |
| 沟通技巧 | 分析沟通场景，理解用户遇到的沟通问题。提炼核心沟通原则和技巧。组织回答：先共情，再给方法，最后鼓励。确保建议实用、可执行。 |
| 职场智慧 | 识别职场问题类型，理解用户处境。结合职场经验和规则，给出专业建议。回答结构：分析问题→提供方案→注意事项。语气要专业且温和，体现理解和关怀。 |

---

## API 使用

### 前端界面导出

**微调任务列表页** (`/finetuning/list.html`)：
- 每个任务卡片上显示 "导出 SFT 数据" 按钮（仅当有已通过数据时显示）
- 点击直接导出为 JSONL 文件

**任务详情页** (`/finetuning/task-detail.html?id=xxx`)：
- 点击右上角 "导出 SFT 数据" 按钮
- 弹出对话框选择：
  - **导出格式**：SFT 格式 / Messages 格式 / Instruction 格式
  - **数据范围**：全部已审核通过 / 仅已通过（≥合格线）
- 点击 "导出" 下载文件

### API 端点

### 导出任务数据

```bash
GET /api/finetuning/task/:id/export?format=sft
```

**参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 微调任务 ID |
| `format` | string | 否 | 导出格式：`sft`（默认）\|`messages`\|`instruction` |
| `dataIds` | array | 否 | 指定导出的数据 ID 列表，为空则导出全部已审核通过的数据 |

**请求示例：**

```bash
# 导出全部已审核通过的数据
curl http://localhost:3000/api/finetuning/task/ft-7b4eef3a-fc34-4905-a423-e4a80502d490/export?format=sft

# 导出指定数据
curl http://localhost:3000/api/finetuning/task/ft-xxx/export?format=sft\&dataIds=pd-xxx,pd-yyy
```

**响应示例：**

```json
{
  "success": true,
  "format": "sft",
  "count": 9,
  "data": [
    "{\"messages\":[{\"role\":\"system\",\"content\":\"You are a helpful assistant.\"},{\"role\":\"user\",\"content\":\"有效反馈需要具体且建设性\"},{\"role\":\"assistant\",\"content\":\"<think>\\n识别职场问题类型，理解用户处境。\\n结合职场经验和规则，给出专业建议。\\n回答结构：分析问题→提供方案→注意事项。\\n语气要专业且温和，体现理解和关怀。\\n</think>\\n\\n有效反馈需要具体且建设性\"}],\"metadata\":{\"id\":\"pd-1774100266579-7gyp3\",\"type\":\"职场智慧\",\"category\":\"职场\"}}",
    "..."
  ]
}
```

---

## 完整工作流

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  创建任务   │ ──> │  导入数据   │ ──> │  AI 审核   │
│  POST /task │     │ POST /import│     │ POST /review│
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
         ┌────────────────────────────────────┘
         ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  导出 SFT   │ <── │  人工审核   │ <── │  AI 优化   │
│ GET /export │     │POST /manual │     │POST /optimize│
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 测试验证

### 运行 UAT 测试

```bash
cd /home/admin/projects/annsight-data-manager
node tests/uat/test-sft-export-uat.js
```

**测试步骤：**

1. ✅ 获取任务列表
2. ✅ 获取任务数据
3. ✅ 导出 SFT 格式
4. ✅ 验证导出格式（messages 数组、system/user/assistant 角色、<think> 标签、metadata）
5. ✅ 显示示例输出
6. ✅ 保存到文件

**测试输出：**

```
============================================================
✅ 🎉 测试完成!
============================================================

📊 测试结果摘要:
   任务 ID: ft-7b4eef3a-fc34-4905-a423-e4a80502d490
   导出条数：9
   执行步骤：6

📋 步骤详情:
   1. 获取任务：✅ success
   2. 获取数据：✅ success
   3. SFT 导出：✅ success
   4. 格式验证：✅ success
   5. 示例输出：✅ success
   6. 保存文件：✅ success
```

---

## 示例数据

### 原始数据（系统内存储）

```json
{
  "id": "pd-1774100266579-7gyp3",
  "type": "职场智慧",
  "category": "职场",
  "title": "有效反馈需要具体且建设性",
  "content": "有效反馈需要具体且建设性",
  "conversation": null
}
```

### 导出后（SFT 格式）

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "有效反馈需要具体且建设性"},
    {"role": "assistant", "content": "<think>\n识别职场问题类型，理解用户处境。\n结合职场经验和规则，给出专业建议。\n回答结构：分析问题→提供方案→注意事项。\n语气要专业且温和，体现理解和关怀。\n</think>\n\n有效反馈需要具体且建设性"}
  ],
  "metadata": {
    "id": "pd-1774100266579-7gyp3",
    "type": "职场智慧",
    "category": "职场",
    "subcategory": null,
    "source": null,
    "batch_id": "ft-batch-1774251395062"
  }
}
```

---

## 文件路径

| 文件 | 路径 |
|------|------|
| 导出服务 | `src/services/FinetuningExportService.js` |
| 路由定义 | `src/routes/finetuning.js` |
| UAT 测试 | `tests/uat/test-sft-export-uat.js` |
| 示例输出 | `/tmp/sft-export-sample.jsonl` |
| 本文档 | `docs/SFT 格式导出指南.md` |

---

## 相关文档

- [微调任务工作流](./finetuning-workflow.md)
- [AI 审核配置](./ai-review.md)
- [API 参考](./api-reference.md)

---

**最后更新**: 2026-03-23
