# AnnSight JSONL 导入全流程测试报告

**测试日期**: 2026-03-22
**测试文件**: `deepseek_jsonl_20260321_e169f5.jsonl`
**数据主题**: 高情商沟通对话数据集（亲子沟通场景）
**测试状态**: ✅ **全部通过**

---

## 📊 测试结果总览

| 步骤 | 状态 | 耗时 | 处理量 | 成功率 |
|------|------|------|--------|--------|
| 1. JSONL 提取 | ✅ | 17ms | 500 条 | 100% |
| 2. ETL 处理 | ✅ | 8ms | 500 条 | 100% |
| 3. 数据入库 | ✅ | 32ms | 500 条 | 100% |
| 4. 微调导出 | ✅ | 4ms | 500 条 | 100% |
| **总计** | ✅ | **66ms** | **500 条** | **100%** |

**处理速度**: 7,576 条/秒

---

## 🔍 详细测试结果

### 步骤 1: JSONL 文件提取

**输入**:
- 文件格式：JSONL（每行一个 JSON 对象）
- 数据格式：OpenAI messages 格式
- 每条包含：system + user + assistant 三轮对话

**提取器**: `JsonlExtractor`
**集成**: ContentRouter 自动路由到 JSONL 提取器

**结果**:
```
✅ 总行数：500
✅ 有效条目：500
✅ 失败行数：0
✅ 提取耗时：17ms
✅ 输出文本：124,346 字符
```

**Conversation 数组验证**:
- 包含 conversation 的条目：500/500 (100%)
- 角色分布：user 500 条、assistant 500 条、system 500 条

---

### 步骤 2: ETL 处理

**处理流程**:
1. **L1 清洗**: 清理文本（多余空格、换行符）
2. **L2 结构化**: 提取对话数据、生成标题
3. **L3 评估**: 完整性评分、AI 置信度评分

**结果**:
```
✅ ETL 耗时：8ms
✅ 处理条目：500
✅ 平均每条：0.016ms
```

**数据标准化**:
```javascript
{
  id: "jsonl-item-1-1742649600000",
  collection_name: "communication_skills",
  type: "沟通技巧",
  category: "高情商沟通",
  subcategory: "亲子沟通",
  target_user: "家长",
  title: "如何用孩子的方式和晚辈建立亲密关系？",
  content: "系统：你是一个高情商的沟通助手...\n\n用户：如何用孩子的方式...\n\n助手：你可以说：...",
  conversation: [
    { role: 'system', content: '...' },
    { role: 'user', content: '...' },
    { role: 'assistant', content: '...' }
  ],
  completeness_score: 1.0,
  ai_confidence_score: 0.95,
  auto_approved: true
}
```

---

### 步骤 3: 数据入库

**数据库**: SQLite (`data/annsight.db`)
**目标表**: `processed_data`

**结果**:
```
✅ 入库耗时：32ms
✅ 成功入库：500 条
✅ 跳过：0 条
✅ 失败：0 条
```

**数据库字段映射**:
| 数据库字段 | 来源 |
|-----------|------|
| `id` | 自动生成 UUID |
| `collection_name` | "communication_skills" |
| `type` | "沟通技巧" |
| `category` | "高情商沟通" |
| `subcategory` | "亲子沟通" |
| `target_user` | "家长" |
| `title` | 用户问题（前 50 字） |
| `content` | 完整提取文本 |
| `conversation` | JSON 序列化对话数组 |
| `completeness_score` | ETL 评分 |
| `ai_confidence_score` | ETL 评分 |
| `auto_approved` | 置信度 ≥ 0.8 |
| `source` | "jsonl_import" |
| `batch_id` | 批次 ID（时间戳） |

---

### 步骤 4: 微调数据导出

**导出格式**: 阿里百炼微调数据集（JSONL）
**输出文件**: `exports/deepseek_finetuning_export.jsonl`

**结果**:
```
✅ 导出耗时：4ms
✅ 导出条数：500
✅ 验证条数：500
```

**导出格式示例**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "如何用孩子的方式和晚辈建立亲密关系？"
    },
    {
      "role": "assistant",
      "content": "你可以说：『我给你拿了两根薯条，一根番茄酱多，一根番茄酱少，你要哪个？』..."
    }
  ]
}
```

**过滤规则**:
- 移除 system 消息（微调数据只需要 user + assistant）
- 仅保留至少 2 轮对话（user + assistant）的数据

---

## 📁 输入输出对比

### 输入格式（OpenAI messages）
```json
{
  "messages": [
    {"role": "system", "content": "你是一个高情商的沟通助手..."},
    {"role": "user", "content": "如何用孩子的方式和晚辈建立亲密关系？"},
    {"role": "assistant", "content": "你可以说：『我给你拿了两根薯条...'}"
  ]
}
```

### 数据库存储格式（processed_data）
```javascript
{
  id: "jsonl-item-1-xxx",
  collection_name: "communication_skills",
  type: "沟通技巧",
  category: "高情商沟通",
  subcategory: "亲子沟通",
  target_user: "家长",
  title: "如何用孩子的方式和晚辈建立亲密关系？",
  content: "系统：你是一个高情商的沟通助手...\n\n用户：如何...\n\n助手：你可以说：...",
  conversation: [
    { role: 'system', content: '...' },
    { role: 'user', content: '...' },
    { role: 'assistant', content: '...' }
  ],
  ai_confidence_score: 0.95,
  auto_approved: true,
  source: 'jsonl_import',
  batch_id: 'batch-xxx'
}
```

### 微调导出格式（阿里百炼）
```json
{
  "messages": [
    {"role": "user", "content": "如何用孩子的方式和晚辈建立亲密关系？"},
    {"role": "assistant", "content": "你可以说：『我给你拿了两根薯条...'}"
  ]
}
```

---

## 🎯 验证清单

| 验证项 | 状态 | 详情 |
|--------|------|------|
| JSONL 解析 | ✅ | 500/500 条成功解析 |
| 格式识别 | ✅ | OpenAI messages 格式正确识别 |
| Conversation 提取 | ✅ | 500 条包含完整对话数组 |
| ContentRouter 路由 | ✅ | 自动路由到 JsonlExtractor |
| ETL 处理 | ✅ | 清洗、结构化、评估完成 |
| 数据标准化 | ✅ | 所有字段正确映射 |
| 数据库入库 | ✅ | 500 条数据成功写入 |
| 微调导出 | ✅ | 500 条符合阿里百炼格式 |
| 数据一致性 | ✅ | 输入=处理=输出=500 条 |

---

## 📊 性能指标

| 指标 | 数值 | 备注 |
|------|------|------|
| 总处理时间 | 66ms | 500 条数据全流程 |
| 处理速度 | 7,576 条/秒 | 平均吞吐量 |
| 单条处理时间 | 0.13ms | 平均每条数据 |
| 提取速度 | 29,412 条/秒 | JSONL 解析速度 |
| ETL 速度 | 62,500 条/秒 | 转换处理速度 |
| 入库速度 | 15,625 条/秒 | SQLite 写入速度 |
| 导出速度 | 125,000 条/秒 | JSONL 导出速度 |

---

## 📁 相关文件

### 源代码
- **JSONL 提取器**: `src/services/extractors/jsonl-extractor.js`
- **ContentRouter**: `src/services/content-router.js`
- **ETL 服务**: `src/pipeline/etl-service.js`
- **数据管道**: `src/pipeline/data-pipeline.js`

### 测试脚本
- **提取测试**: `tests/uat/v4/test-jsonl-import.js`
- **全流程测试**: `tests/uat/v4/test-jsonl-etl-full.js`

### 测试数据
- **输入文件**: `/home/admin/Downloads/deepseek_jsonl_20260321_e169f5.jsonl`
- **导出文件**: `exports/deepseek_finetuning_export.jsonl`

### 文档
- **测试报告**: `tests/uat/v4/JSONL_TEST_REPORT.md`
- **本文档**: `tests/uat/v4/JSONL_FULL_PIPELINE_REPORT.md`

---

## 🚀 使用说明

### 导入新的 JSONL 文件

1. **准备 JSONL 文件**（OpenAI messages 格式）:
```jsonl
{"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

2. **运行导入命令**:
```bash
# 运行全流程测试（包含导入）
node tests/uat/v4/test-jsonl-etl-full.js

# 或者通过 API 上传（服务启动后）
curl -X POST http://localhost:3000/api/raw-data/upload \
  -F "file=@your-data.jsonl" \
  -F "batchId=batch-001" \
  -F "source=submission"
```

3. **验证结果**:
```bash
# 检查导出文件
cat exports/deepseek_finetuning_export.jsonl | wc -l
```

---

## ⚠️ 注意事项

1. **文件格式**: 确保 JSONL 文件每行是一个完整的 JSON 对象
2. **字符编码**: 必须为 UTF-8 编码
3. **对话格式**: 微调数据需要至少 user + assistant 两轮对话
4. **数据库**: 确保数据库表结构已初始化
5. **文件路径**: 使用绝对路径避免路径错误

---

## 🔮 后续优化

- [ ] 支持增量导入（跳过已存在的条目）
- [ ] 支持大文件流式处理
- [ ] 添加导入进度条显示
- [ ] 支持自定义分类映射
- [ ] 添加数据质量报告
- [ ] 支持批量文件导入

---

## 📞 技术支持

**测试命令**:
```bash
# JSONL 提取测试
node tests/uat/v4/test-jsonl-import.js

# 全流程测试
node tests/uat/v4/test-jsonl-etl-full.js

# 全部 UAT 测试
node tests/uat/v4/test-multi-format.js
```

**查看详细日志**:
```bash
# 启用调试模式
DEBUG=annsight:* node tests/uat/v4/test-jsonl-etl-full.js
```

---

**测试结论**: ✅ JSONL 导入全流程功能完整，性能优异，可直接用于生产环境。
