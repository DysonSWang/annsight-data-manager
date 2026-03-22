# AnnSight JSONL 导入快速参考

## 🚀 快速开始

### 1. 准备 JSONL 文件

确保你的 JSONL 文件符合以下格式之一：

**格式 1: OpenAI messages（推荐）**
```jsonl
{"messages": [{"role": "user", "content": "问题"}, {"role": "assistant", "content": "回答"}]}
```

**格式 2: Input-Output**
```jsonl
{"input": "问题", "output": "回答"}
```

**格式 3: QA**
```jsonl
{"question": "问题", "answer": "回答"}
```

**格式 4: 纯文本**
```jsonl
{"text": "内容文本"}
```

### 2. 运行导入

```bash
cd /home/admin/projects/annsight-data-manager

# 方法 A: 使用测试脚本（推荐用于验证）
node tests/uat/v4/test-jsonl-etl-full.js

# 方法 B: 使用提取测试
node tests/uat/v4/test-jsonl-import.js

# 方法 C: 代码调用
node -e "
const { JsonlExtractor } = require('./src/services/extractors/jsonl-extractor');
const extractor = new JsonlExtractor();
extractor.extract('/path/to/your/file.jsonl').then(r => {
    console.log('提取', r.metadata.validItems, '条数据');
});
"
```

### 3. 验证结果

```bash
# 查看导出文件
wc -l exports/deepseek_finetuning_export.jsonl

# 预览前 3 条
head -3 exports/deepseek_finetuning_export.jsonl | python3 -m json.tool
```

---

## 📊 测试结果参考

**500 条数据处理结果**:
```
✅ 提取耗时：17ms
✅ ETL 处理：8ms
✅ 数据入库：32ms
✅ 微调导出：4ms
✅ 总耗时：66ms (0.07 秒)
✅ 处理速度：7,576 条/秒
```

---

## 📁 文件位置

| 类型 | 路径 |
|------|------|
| 测试数据 | `/home/admin/Downloads/deepseek_jsonl_20260321_e169f5.jsonl` |
| 导出文件 | `exports/deepseek_finetuning_export.jsonl` |
| 提取器 | `src/services/extractors/jsonl-extractor.js` |
| 测试脚本 | `tests/uat/v4/test-jsonl-*.js` |

---

## 🧪 运行测试

```bash
# 全部 UAT 测试（37 项）
node tests/uat/v4/test-multi-format.js

# 仅 JSONL 测试（7 项）
node tests/uat/v4/test-jsonl-import.js

# 全流程测试
node tests/uat/v4/test-jsonl-etl-full.js
```

---

## 📖 详细文档

- **提取器测试**: `tests/uat/v4/JSONL_TEST_REPORT.md`
- **全流程报告**: `tests/uat/v4/JSONL_FULL_PIPELINE_REPORT.md`
- **完成总结**: `tests/uat/v4/JSONL_IMPORT_COMPLETE.md`

---

## ⚠️ 常见问题

**Q: 文件不存在错误？**
A: 使用绝对路径，确保文件存在

**Q: 解析失败？**
A: 检查 JSONL 格式，确保每行是独立的 JSON 对象

**Q: conversation 数组为空？**
A: 确保使用 OpenAI messages 格式 `{ messages: [...] }`

**Q: 导出文件格式不对？**
A: 微调数据只保留 user 和 assistant 角色，过滤掉 system

---

**更新日期**: 2026-03-22
**版本**: v4.0
