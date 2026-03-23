# 微调数据审核优化流程 - 实现完成

**实现日期**: 2026-03-23
**状态**: ✅ 已完成

---

## 实现总结

已完成微调数据从导入→AI 审核→AI 优化→人工审核→导出的完整流程。

---

## 新增文件

### 后端

| 文件 | 说明 |
|------|------|
| `scripts/migrations/002-finetuning-task.sql` | 数据库迁移（finetuning_tasks, review_rounds 表） |
| `src/repository/FinetuningTaskRepository.js` | 微调任务数据访问层 |
| `src/repository/ReviewRoundRepository.js` | 审核轮次数据访问层 |
| `src/services/AiReviewService.js` | AI 审核服务（智谱 AI 集成） |
| `src/services/AiOptimizeService.js` | AI 优化服务（根据审核意见优化） |
| `src/services/FinetuningTaskService.js` | 任务管理服务（编排整个流程） |
| `src/prompts/finetuning-review.js` | AI 审核 Prompt 模板 |
| `src/prompts/finetuning-optimize.js` | AI 优化 Prompt 模板 |
| `src/routes/finetuning.js` | 微调任务 API 路由 |

### 前端

| 文件 | 说明 |
|------|------|
| `public/finetuning/list.html` | 任务列表页面 |
| `public/finetuning/task-detail.html` | 任务详情页面 |
| `public/finetuning/review.html` | 数据审核详情页面 |

### 修改的文件

| 文件 | 修改 |
|------|------|
| `src/index.js` | 注册 `/api/finetuning` 路由 |
| `scripts/migrate.js` | 支持执行新的迁移文件 |
| `package.json` | 添加 `test:finetuning` 脚本 |

### 测试文件

| 文件 | 说明 |
|------|------|
| `tests/uat/test-finetuning-workflow-uat.js` | 完整工作流程 UAT 测试 |
| `IMPLEMENTATION.md` | 实现文档 |

---

## 数据库变更

### 新增表

1. **finetuning_tasks** - 微调任务配置表
   - `id`, `name`, `purpose`, `pass_threshold`, `max_review_rounds`
   - `manual_review_enabled`, `manual_review_scope`
   - `status`, `batch_id`, `created_at`

2. **review_rounds** - 审核轮次追踪表
   - `task_id`, `data_id`, `round_number`, `round_type`
   - `ai_score`, `ai_dimension_scores`, `ai_feedback`, `ai_suggestions`
   - `optimized`, `optimization_result`
   - `manual_reviewed`, `manual_decision`, `manual_reason`

3. **v_task_progress** - 任务进度视图
4. **v_data_review_detail** - 数据审核详情视图

---

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/finetuning/task` | POST | 创建微调任务 |
| `/api/finetuning/task` | GET | 获取任务列表 |
| `/api/finetuning/task/:id` | GET | 获取任务详情 |
| `/api/finetuning/task/:id/import` | POST | 导入数据到任务 |
| `/api/finetuning/task/:id/review/start` | POST | 启动 AI 审核 |
| `/api/finetuning/task/:id/review/status` | GET | 获取审核进度 |
| `/api/finetuning/task/:id/optimize/start` | POST | 启动 AI 优化 |
| `/api/finetuning/task/:id/manual-review/start` | POST | 启动人工审核 |
| `/api/finetuning/task/:id/data` | GET | 获取任务数据列表 |
| `/api/finetuning/task/:id/data/:dataId` | GET | 获取单条数据审核详情 |
| `/api/finetuning/task/:id/data/:dataId/manual-review` | POST | 提交人工审核结果 |
| `/api/finetuning/task/:id/complete` | POST | 完成任务 |
| `/api/finetuning/task/:id` | DELETE | 删除任务 |

---

## 使用流程

### 1. 创建微调任务

访问 http://localhost:3000/finetuning/list.html 点击"新建任务"，或通过 API：

```bash
curl -X POST http://localhost:3000/api/finetuning/task \
  -H "Content-Type: application/json" \
  -d '{
    "name": "客服对话微调 -202603",
    "purpose": "用于训练客服对话模型的问答能力",
    "pass_threshold": 0.90,
    "max_review_rounds": 2,
    "manual_review_enabled": true,
    "manual_review_scope": "failed"
  }'
```

### 2. 导入数据

```bash
curl -X POST http://localhost:3000/api/finetuning/task/{taskId}/import \
  -H "Content-Type: application/json" \
  -d '{"source_batch_id": "your-batch-id"}'
```

### 3. 启动 AI 审核（10 并发高效模式）

```bash
curl -X POST http://localhost:3000/api/finetuning/task/{taskId}/review/start \
  -H "Content-Type: application/json" \
  -d '{"concurrency": 10}'
```

### 4. 启动 AI 优化

```bash
curl -X POST http://localhost:3000/api/finetuning/task/{taskId}/optimize/start \
  -H "Content-Type: application/json" \
  -d '{"concurrency": 5}'
```

### 5. 启动人工审核

```bash
curl -X POST http://localhost:3000/api/finetuning/task/{taskId}/manual-review/start
```

---

## 核心特性

1. **高效并行审核** - 默认 10 并发，可配置
2. **多轮审核优化** - 支持最多 5 轮 AI 审核 + 优化
3. **智能评分系统** - 4 个维度评分（完整性、遵循度、质量、适用性）
4. **全流程审计** - 每轮 AI 审核、优化、人工审核都有完整记录
5. **灵活配置** - 合格分、审核轮次、人工审核范围均可配置
6. **AI 审核专家** - 世界级数据挖掘和模型微调专家评审
7. **AI 优化专家** - 根据审核意见自动优化数据

---

## 快速开始

```bash
# 1. 运行数据库迁移
cd /home/admin/projects/annsight-data-manager
node scripts/migrate.js

# 2. 启动服务
npm start

# 3. 访问系统
# http://localhost:3000/finetuning/list.html

# 4. 运行 UAT 测试
npm run test:finetuning
```

---

## 环境变量

确保 `.env` 文件中配置了智谱 AI API：

```env
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=annsight_data
DB_USER=postgres
DB_PASSWORD=postgres

# 智谱 AI 配置
ZHIPU_API_KEY=your-api-key-here
ZHIPU_MODEL=glm-4
```

---

## 待办事项

- [ ] 数据导出功能（JSONL 格式）
- [ ] 任务进度实时推送（WebSocket）
- [ ] 批量导入数据支持
- [ ] 审核日志导出
