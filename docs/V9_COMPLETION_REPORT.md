# V9 分流器整合完成报告

**完成时间**: 2026-03-26
**整合版本**: v1.0

---

## 一、整合概述

将 eq-trainning 项目的 V9 转录数据处理能力整合进 annsight-data-manager 系统，实现：
- 转录文件 → 多类型素材（SFT/RAG/DPO/Story/Content）
- 统一存储到 processed_data 表
- 通过微调任务进行素材导入和进一步处理

---

## 二、已完成工作

### 2.1 数据库扩展

**迁移文件**: `scripts/migrations/007-add-material-columns.sql`
- 新增字段：`material_type`, `source_video`, `source_timestamp`, `content_type`, `quality_score`
- 新增索引：`idx_processed_material_type`, `idx_processed_content_type`, `idx_processed_source_video`

**迁移文件**: `scripts/migrations/008-add-finetuning-task-reference.sql`
- 新增字段：`finetuning_task_id` (关联微调任务), `used_in_finetuning`
- 外键约束：`REFERENCES finetuning_tasks(id) ON DELETE SET NULL`

### 2.2 Python 模块 (V9 分流器)

**位置**: `src/services/v9-shunt/`

| 模块 | 功能 |
|------|------|
| `classifier.py` | 多标签分类器 (9 种特征识别 + 内容类型分流 A/B/C/D/E/F/SKIP) |
| `extract_sft_v9_shunt.py` | SFT 微调数据提取 (3-Agent 流水线) |
| `extract_rag_knowledge.py` | RAG 知识库提取 (Dify 导入格式) |
| `extract_dpo_v9.py` | DPO 偏好数据提取 (正负样本对) |
| `extract_story_material.py` | 故事素材提取 (场景/冲突/解决/结局) |
| `extract_content_materials.py` | 内容素材提取 (神回复/神暗示/神操作/前车之鉴/理论精讲) |
| `run_shunt_v9.py` | 一键运行所有管道，支持断点续传 |

### 2.3 Node.js 服务层

**MaterialRepository.js** (`src/repository/MaterialRepository.js`)
- `findList(options)` - 素材列表查询（支持类型/状态/内容类型筛选）
- `getStats()` - 素材统计（按类型/内容类型分组）
- `findAvailableForTask(taskType)` - 获取可导入微调任务的素材
- `saveBatch(materials)` - 批量保存素材
- `batchUpdate(ids, updates)` - 批量更新素材
- `findById(id)` - 素材详情查询

**MaterialExtractionService.js** (`src/services/MaterialExtractionService.js`)
- `checkReady()` - 检查 V9 模块就绪状态
- `runShunt(options)` - 运行 V9 分流器
- `runPipeline(pipeline, options)` - 运行单个管道
- `readPipelineOutput(pipeline)` - 读取管道输出
- `getReport()` - 获取统计报告

### 2.4 API 路由

**路由文件**: `src/routes/materials.js`
**路由前缀**: `/api/materials`

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/materials/list` | GET | 素材列表（支持分页和筛选） |
| `/api/materials/stats` | GET | 素材统计 |
| `/api/materials/:id` | GET | 素材详情 |
| `/api/materials/:id` | PUT | 更新素材 |
| `/api/materials/:id` | DELETE | 删除素材 |
| `/api/materials/batch-update` | POST | 批量更新素材 |
| `/api/materials/extract` | POST | 启动 V9 素材提取 |
| `/api/materials/extract/:pipeline` | POST | 运行单个管道 |
| `/api/materials/output/:pipeline` | GET | 读取管道输出 |
| `/api/materials/report` | GET | 获取统计报告 |
| `/api/materials/import` | POST | 批量导入 V9 素材 |
| `/api/finetuning/task/:id/available-materials` | GET | 获取可导入微调任务的素材 |

### 2.5 前端页面

**素材管理页面**: `public/materials.html`
- 统计看板（总数/SFT/RAG/DPO/Story/Content 数量）
- V9 提取启动面板（管道选择/配置）
- 素材列表（支持类型/内容类型/状态筛选）
- 素材详情查看
- 批量操作（审核/删除/导入）

**微调任务详情页增强**: `public/finetuning/task-detail.html`
- 导入模态框标签页切换（源数据批次 / V9 素材）
- V9 素材列表展示（支持按类型筛选）
- 素材选择功能（单选/全选）
- 导入逻辑集成（支持两种数据源）

**微调任务列表页增强**: `public/finetuning/list.html`
- 导航栏添加"素材库"入口

### 2.6 文档

**整合文档**: `docs/V9_INTEGRATION.md`
- 数据库扩展说明
- V9 模块介绍
- API 端点列表
- 使用流程
- 故障排查

---

## 三、工作流程

### 3.1 素材提取流程

```
1. 上传转录文件到指定目录
   ↓
2. 调用 POST /api/materials/extract
   - 参数：{ transcriptsRoot, pipelines: ["all"] }
   ↓
3. V9 分流器执行 6 个管道
   - classifier: 内容分类
   - content: 内容素材提取
   - rag: RAG 知识库提取
   - sft: SFT 微调数据提取
   - dpo: DPO 偏好数据提取
   - story: 故事素材提取
   ↓
4. 输出 JSONL 文件到 eq-trainning/t2/output/
   ↓
5. 调用 POST /api/materials/import 批量导入数据库
```

### 3.2 微调任务导入流程

```
1. 创建微调任务
   ↓
2. 访问任务详情页 /finetuning/task-detail.html?id={taskId}
   ↓
3. 点击"导入数据"按钮
   ↓
4. 选择标签页:
   - 源数据批次：从 AI 审核通过的源数据批次导入
   - V9 素材：从 V9 提取的素材库导入
   ↓
5. 选择素材/批次，配置审核参数
   ↓
6. 点击"导入"完成关联
```

---

## 四、API 调用示例

### 4.1 启动 V9 提取

```bash
POST http://localhost:3000/api/materials/extract
Content-Type: application/json

{
  "transcriptsRoot": "/path/to/transcripts",
  "pipelines": ["all"],
  "dryRun": false
}
```

### 4.2 获取素材统计

```bash
GET http://localhost:3000/api/materials/stats

响应：
{
  "success": true,
  "data": {
    "total": 150,
    "byType": {
      "sft": 50,
      "rag": 40,
      "dpo": 30,
      "story": 20,
      "content": 10
    },
    "byContentType": {
      "A": 25,
      "B": 35,
      "C": 30,
      "D": 20,
      "E": 15,
      "F": 10,
      "SKIP": 15
    }
  }
}
```

### 4.3 获取可导入素材

```bash
GET http://localhost:3000/api/finetuning/task/{taskId}/available-materials?type=sft

响应：
{
  "success": true,
  "data": [
    {
      "id": "sft_001",
      "type": "sft",
      "category": "职场沟通",
      "title": "高情商回应批评",
      "content": "...",
      "quality_score": 0.95
    }
  ]
}
```

---

## 五、环境变量配置

在 `.env` 文件中配置：

```env
# V9 配置
V9_DIR=/home/admin/projects/eq-trainning/t2
V9_API_KEY=your-api-key
V9_BASE_URL=https://open.bigmodel.cn/api/paas/v4

# 转录文件根目录（可选）
TRANSCRIPTS_ROOT=/path/to/transcripts
```

---

## 六、数据库迁移

运行迁移：
```bash
node scripts/migrate.js
```

验证字段：
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'processed_data'
  AND column_name IN ('material_type', 'source_video', 'content_type', 'quality_score', 'finetuning_task_id');
```

---

## 七、测试验证

### 7.1 检查 V9 模块就绪状态

```bash
node -e "
const MaterialExtractionService = require('./src/services/MaterialExtractionService');
const service = new MaterialExtractionService();
service.checkReady().then(console.log);
"
```

### 7.2 API 测试

```bash
# 健康检查
curl http://localhost:3000/api/health

# 素材统计
curl http://localhost:3000/api/materials/stats

# 素材列表
curl "http://localhost:3000/api/materials/list?type=sft&pageSize=10"
```

---

## 八、后续优化建议

### P0 - 立即可做
- [ ] 测试完整 V9 提取→导入→审核→导出流程
- [ ] 验证 V9 素材在微调任务中的审核表现
- [ ] 补充前端错误处理和加载状态优化

### P1 - 短期优化
- [ ] V9 提取进度实时查看（WebSocket 或轮询）
- [ ] 提取结果质量审核流程
- [ ] 素材与源文件的血缘追踪

### P2 - 长期优化
- [ ] 多转录源支持（本地文件/OSS/URL）
- [ ] 素材版本管理
- [ ] 自动去重和语义相似度检测

---

## 九、相关文件清单

### 数据库
- `scripts/migrations/007-add-material-columns.sql`
- `scripts/migrations/008-add-finetuning-task-reference.sql`
- `scripts/migrate.js`

### Node.js 服务
- `src/repository/MaterialRepository.js`
- `src/services/MaterialExtractionService.js`
- `src/routes/materials.js`
- `src/index.js` (路由注册)

### Python 模块
- `src/services/v9-shunt/classifier.py`
- `src/services/v9-shunt/extract_sft_v9_shunt.py`
- `src/services/v9-shunt/extract_rag_knowledge.py`
- `src/services/v9-shunt/extract_dpo_v9.py`
- `src/services/v9-shunt/extract_story_material.py`
- `src/services/v9-shunt/extract_content_materials.py`
- `src/services/v9-shunt/run_shunt_v9.py`

### 前端页面
- `public/materials.html`
- `public/finetuning/list.html`
- `public/finetuning/task-detail.html`

### 文档
- `docs/V9_INTEGRATION.md`
- `docs/V9_COMPLETION_REPORT.md` (本文档)

---

**最后更新**: 2026-03-26
**状态**: ✅ 基础整合完成，等待流程验证
