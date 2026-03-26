# V9 分流器整合文档

**整合时间**: 2026-03-26
**版本**: v1.0

---

## 一、整合概述

### 1.1 项目定位

**V9 分流器** = 阶段 1 的"抽提整理"引擎

将 eq-trainning 项目的 V9 转录数据处理能力整合进 annsight-data-manager 系统，实现：
- 转录文件 → 多类型素材（SFT/RAG/DPO/Story/Content）
- 统一存储到 processed_data 表
- 通过微调任务进行素材导入和进一步处理

### 1.2 工作流程

```
源文件上传 → AI 审核 → V9 抽提整理 → 原始素材
                                    ↓
                              存入素材库
                                    ↓
                          微调任务选中导入
                                    ↓
                            AI 审核/人工审核
                                    ↓
                              导出 SFT/DPO
```

---

## 二、数据库扩展

### 2.1 processed_data 表新增字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `material_type` | VARCHAR(50) | 素材类型：sft/rag/dpo/story/content |
| `source_video` | VARCHAR(255) | 源视频标题 |
| `source_timestamp` | VARCHAR(50) | 源视频时间戳 |
| `content_type` | VARCHAR(10) | V9 分类：A/B/C/D/E/F/SKIP |
| `quality_score` | DECIMAL(3,2) | 质量分 0-1 |

### 2.2 索引

```sql
CREATE INDEX idx_processed_material_type ON processed_data(material_type);
CREATE INDEX idx_processed_content_type ON processed_data(content_type);
CREATE INDEX idx_processed_source_video ON processed_data(source_video);
```

### 2.3 迁移文件

- 文件：`scripts/migrations/007-add-material-columns.sql`
- 运行：`node scripts/migrate.js`

---

## 三、V9 Python 模块

### 3.1 模块位置

```
src/services/v9-shunt/
├── classifier.py              # 多标签分类器
├── extract_sft_v9_shunt.py    # SFT 数据提取（3-Agent 流水线）
├── extract_rag_knowledge.py   # RAG 知识库提取
├── extract_dpo_v9.py          # DPO 偏好数据提取
├── extract_story_material.py  # 故事素材提取
├── extract_content_materials.py # 内容素材提取
└── run_shunt_v9.py           # 一键运行所有管道
```

### 3.2 管道说明

| 管道 | 输出文件 | 用途 |
|------|---------|------|
| **classifier** | classification_result.json | 内容分类（A/B/C/D/E/F/SKIP） |
| **sft** | sft_data.jsonl | 微调数据（question + thinking + answer） |
| **rag** | rag_knowledge.jsonl | RAG 知识库（Dify 导入格式） |
| **dpo** | dpo_data.jsonl | 偏好数据（chosen/rejected 对） |
| **story** | story_materials.jsonl | 故事素材（场景/冲突/解决/结局） |
| **content** | content_materials.jsonl | 内容素材（神回复/神暗示/神操作/前车之鉴/理论精讲） |

### 3.3 运行方式

```bash
# 检查就绪状态
python3 run_shunt_v9.py --dry-run

# 运行所有管道
python3 run_shunt_v9.py --all

# 运行指定管道
python3 run_shunt_v9.py --pipe 3  # 只运行 SFT 提取

# 生成统计报告
python3 run_shunt_v9.py --report
```

---

## 四、Node.js 服务层

### 4.1 MaterialExtractionService

**文件**: `src/services/MaterialExtractionService.js`

**核心方法**:
- `checkReady()` - 检查 V9 模块就绪状态
- `runShunt(options)` - 运行 V9 分流器
- `runPipeline(pipeline, options)` - 运行单个管道
- `readPipelineOutput(pipeline)` - 读取管道输出
- `getReport()` - 获取统计报告

**使用示例**:
```javascript
const service = new MaterialExtractionService({
    v9Dir: '/home/admin/projects/eq-trainning/t2',
    apiKey: process.env.V9_API_KEY
});

// 检查就绪状态
const ready = await service.checkReady();

// 运行 SFT 管道
const result = await service.runPipeline('sft', {
    transcriptsRoot: '/path/to/transcripts'
});

// 读取输出
const data = await service.readPipelineOutput('sft');
```

### 4.2 MaterialRepository

**文件**: `src/repository/MaterialRepository.js`

**核心方法**:
- `findList(options)` - 获取素材列表（支持筛选）
- `getStats()` - 获取素材统计
- `findAvailableForTask(taskType)` - 获取可导入微调任务的素材
- `saveBatch(materials)` - 批量保存素材
- `batchUpdate(ids, updates)` - 批量更新素材
- `findById(id)` - 获取素材详情

---

## 五、API 端点

### 5.1 素材管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/materials/list` | GET | 获取素材列表（支持筛选和分页） |
| `/api/materials/stats` | GET | 获取素材统计 |
| `/api/materials/:id` | GET | 获取素材详情 |
| `/api/materials/:id` | PUT | 更新素材 |
| `/api/materials/:id` | DELETE | 删除素材 |
| `/api/materials/batch-update` | POST | 批量更新素材 |

### 5.2 V9 提取

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/materials/extract` | POST | 启动 V9 素材提取 |
| `/api/materials/extract/:pipeline` | POST | 运行单个管道 |
| `/api/materials/output/:pipeline` | GET | 读取管道输出 |
| `/api/materials/report` | GET | 获取统计报告 |
| `/api/materials/import` | POST | 批量导入 V9 素材 |

### 5.3 微调任务关联

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/finetuning/task/:id/available-materials` | GET | 获取可导入微调任务的素材 |

### 5.4 请求示例

**启动 V9 提取**:
```bash
POST /api/materials/extract
{
  "transcriptsRoot": "/path/to/transcripts",
  "pipelines": ["sft", "rag"],
  "dryRun": false
}
```

**获取素材列表**:
```bash
GET /api/materials/list?type=sft&status=approved&page=1&pageSize=50
```

**获取可导入 SFT 任务的素材**:
```bash
GET /api/finetuning/task/{taskId}/available-materials?type=sft
```

---

## 六、前端增强（待实现）

### 6.1 素材管理页面

新建 `/materials.html`:
- 素材列表（支持类型/状态筛选）
- 素材详情查看
- V9 提取启动入口
- 批量操作

### 6.2 微调任务页面增强

**任务创建页** (`/finetuning/list.html`):
- 增加"素材类型"筛选项
- 显示各类型素材数量

**任务详情页** (`/finetuning/task-detail.html`):
- "导入数据"按钮旁增加"导入素材"按钮
- 弹窗显示可选素材列表（按类型分组）

---

## 七、环境变量配置

在 `.env` 文件中添加:

```env
# V9 配置
V9_DIR=/home/admin/projects/eq-trainning/t2
V9_API_KEY=your-api-key
V9_BASE_URL=https://open.bigmodel.cn/api/paas/v4

# 转录文件根目录（可选）
TRANSCRIPTS_ROOT=/path/to/transcripts
```

---

## 八、使用流程

### 8.1 首次使用

1. **运行数据库迁移**:
   ```bash
   node scripts/migrate.js
   ```

2. **验证 V9 模块就绪**:
   ```bash
   node -e "
   const MaterialExtractionService = require('./src/services/MaterialExtractionService');
   const service = new MaterialExtractionService();
   service.checkReady().then(console.log);
   "
   ```

3. **启动服务**:
   ```bash
   npm start
   ```

### 8.2 素材提取流程

1. **上传转录文件**到指定目录

2. **启动 V9 提取**:
   ```bash
   curl -X POST http://localhost:3000/api/materials/extract \
     -H "Content-Type: application/json" \
     -d '{
       "transcriptsRoot": "/path/to/transcripts",
       "pipelines": ["all"]
     }'
   ```

3. **查看提取结果**:
   ```bash
   curl http://localhost:3000/api/materials/stats
   ```

4. **导入到微调任务**:
   - 访问 `/finetuning/task/{id}`
   - 点击"导入素材"
   - 选择 SFT/RAG/DPO 类型素材
   - 确认导入

---

## 九、故障排查

### 9.1 V9 模块未就绪

**错误**: `V9 模块未就绪，missing: ['classifier.py', ...]`

**解决**:
- 检查 `V9_DIR` 环境变量是否正确配置
- 确认 `src/services/v9-shunt/` 目录下文件完整

### 9.2 Python 脚本执行失败

**错误**: `python3: command not found` 或其他 Python 相关错误

**解决**:
- 确认 Python 3 已安装：`python3 --version`
- 检查依赖：`pip3 install aiohttp asyncio`

### 9.3 数据库字段不存在

**错误**: `column "material_type" does not exist`

**解决**:
- 重新运行迁移：`node scripts/migrate.js`
- 验证字段：`SELECT column_name FROM information_schema.columns WHERE table_name = 'processed_data'`

---

## 十、后续优化

### 10.1 短期（P0）

- [ ] 前端素材管理页面
- [ ] 微调任务页面素材导入功能
- [ ] V9 提取进度实时查看（WebSocket 或轮询）

### 10.2 中期（P1）

- [ ] V9 提取任务队列（支持并发控制）
- [ ] 提取结果质量审核流程
- [ ] 素材与源文件的血缘追踪

### 10.3 长期（P2）

- [ ] 多转录源支持（本地文件/OSS/URL）
- [ ] 素材版本管理
- [ ] 自动去重和语义相似度检测

---

## 十一、相关文件

- 数据库迁移：`scripts/migrations/007-add-material-columns.sql`
- MaterialRepository: `src/repository/MaterialRepository.js`
- MaterialExtractionService: `src/services/MaterialExtractionService.js`
- Materials Routes: `src/routes/materials.js`
- V9 Python 模块：`src/services/v9-shunt/`
- 主入口：`src/index.js`

---

**最后更新**: 2026-03-26
