# JSONL 导入测试报告

**测试日期**: 2026-03-22
**测试文件**: `deepseek_jsonl_20260321_e169f5.jsonl` (500 条高情商沟通对话数据)
**测试状态**: ✅ 通过

---

## 📊 测试结果总览

| 测试项 | 结果 | 详情 |
|--------|------|------|
| JSONL 提取器 | ✅ 通过 | 500/500 条数据成功提取 |
| ContentRouter 集成 | ✅ 通过 | 正确路由到 JSONL 提取器 |
| 格式兼容性 | ✅ 通过 | 支持 4 种 JSONL 格式 |
| Conversation 提取 | ✅ 通过 | 500 条包含完整对话数组 |

---

## 🔍 详细测试结果

### 1. JSONL 提取器测试

**性能指标**:
- 总行数：500
- 有效条目：500 (100%)
- 失败行数：0
- 提取耗时：17ms

**数据格式**:
- 格式类型：OpenAI messages 格式
- 每条包含：system + user + assistant 三轮对话
- conversation 数组：100% 提取成功

**角色分布**:
- system: 500 条
- user: 500 条
- assistant: 500 条

### 2. ContentRouter 集成测试

**路由结果**:
- 输入类型：`{"type":"file","path":"..."}`
- 检测类型：JSONL (.jsonl 扩展名)
- 路由目标：JsonlExtractor
- 处理耗时：13ms
- 输出文本：124,346 字符

**元数据**:
```json
{
  "format": "jsonl",
  "totalLines": 500,
  "validItems": 500,
  "failedLines": 0
}
```

### 3. 格式兼容性测试

**支持的 MIME 类型**:
- `application/jsonl`
- `application/x-jsonlines`

**文件扩展名检测**:
- ✅ `.jsonl` → 识别为 JSONL
- ✅ `.JSONL` → 识别为 JSONL (大小写不敏感)
- ✅ `.json` → 识别为 JSON (非 JSONL)
- ✅ `.txt` → 识别为 TEXT

**格式兼容性**:
| 格式 | 示例 | 状态 |
|------|------|------|
| OpenAI messages | `{ messages: [...] }` | ✅ 支持 |
| Input-Output | `{ input, output }` | ✅ 支持 |
| 纯文本 | `{ text }` | ✅ 支持 |
| 问答 | `{ question, answer }` | ✅ 支持 |

---

## 📋 数据样例

### 输入格式 (JSONL)
```json
{"messages": [
  {"role": "system", "content": "你是一个高情商的沟通助手..."},
  {"role": "user", "content": "如何用孩子的方式和晚辈建立亲密关系？"},
  {"role": "assistant", "content": "你可以说：『我给你拿了两根薯条...'}
]}
```

### 输出格式 (提取后)
```javascript
{
  text: "系统：你是一个高情商的沟通助手...\n\n用户：如何用孩子的方式...\n\n助手：你可以说：...",
  metadata: {
    format: 'openai_messages',
    messageCount: 3,
    systemPrompt: '...',
    userPrompt: '...'
  },
  conversation: [
    { role: 'system', content: '...' },
    { role: 'user', content: '...' },
    { role: 'assistant', content: '...' }
  ],
  lineNumber: 1
}
```

---

## 🎯 测试结论

1. **JSONL 提取器功能完整**
   - ✅ 正确解析 JSONL 格式（每行一个 JSON 对象）
   - ✅ 支持 OpenAI messages 格式
   - ✅ 提取 conversation 数组用于微调数据
   - ✅ 生成标题和元数据

2. **ContentRouter 集成成功**
   - ✅ 自动识别 .jsonl 扩展名
   - ✅ 路由到 JsonlExtractor
   - ✅ 保持统一的输出格式

3. **数据质量验证**
   - ✅ 500 条数据 100% 解析成功
   - ✅ conversation 数组 100% 提取
   - ✅ 无失败行

---

## 🚀 后续步骤

### 1. ETL 处理（下一步）
将提取的数据送入 ETL 管道：
- L1 清洗 → L2.5 裂变 → L2 结构化 → L3 评估 → 去重

### 2. 数据入库
将处理后的数据保存到数据库：
- `raw_data_index` 表：原始文件索引
- `processed_data` 表：结构化数据

### 3. 微调数据导出
导出为阿里百炼格式：
```jsonl
{"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

---

## 📞 测试命令

```bash
# 运行 JSONL 导入测试
node tests/uat/v4/test-jsonl-import.js

# 运行全部 UAT 测试
node tests/uat/v4/test-multi-format.js
```

---

## 📁 相关文件

- 提取器：`src/services/extractors/jsonl-extractor.js`
- 路由器：`src/services/content-router.js`
- 测试脚本：`tests/uat/v4/test-jsonl-import.js`
- 测试数据：`/home/admin/Downloads/deepseek_jsonl_20260321_e169f5.jsonl`
