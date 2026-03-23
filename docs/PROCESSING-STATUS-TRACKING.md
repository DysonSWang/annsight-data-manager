# 处理状态追踪功能

## 功能概述

在源数据管理（raw_data.html）中添加了 ETL 处理状态追踪功能，可以实时查看数据在 ETL Pipeline 中的处理进度。

## 新增字段

### 数据库字段

在 `raw_data_index` 表中新增 `processing_status` 字段：

```sql
processing_status VARCHAR(50) DEFAULT NULL
```

### 处理状态值

| 状态值 | 说明 | 对应 Pipeline 步骤 |
|--------|------|-------------------|
| `processing_l1_clean` | 清洗中 | L1 文本清洗 |
| `processing_l25_fission` | 裂变中 | L2.5 数据裂变 |
| `processing_l2_structure` | 结构化中 | L2 结构化 |
| `processing_l3_evaluate` | 评估中 | L3 质量评估 |
| `processing_dedup` | 去重中 | 去重处理 |
| `processed` | 处理完成 | Pipeline 执行完成 |

## 前端展示

### 列表页面

在源数据列表表格中新增"处理阶段"列，显示当前数据所处的处理阶段：

- **处理中**：带脉冲动画的彩色徽章
- **已完成**：绿色徽章
- **未处理**：显示 `-`

### 详情页面

点击"查看"按钮打开详情模态框，显示：

1. **处理进度条**：以图标 + 文字形式展示 6 个处理阶段的进度
2. **当前状态高亮**：当前阶段带脉冲动画
3. **已完成阶段**：深色背景
4. **未完成阶段**：灰色背景

## 后端实现

### 1. Repository 层

新增方法 `updateProcessingStatus`：

```javascript
async updateProcessingStatus(id, processingStatus) {
    const query = `
        UPDATE raw_data_index
        SET processing_status = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
    `;
    await this.pool.query(query, [id, processingStatus]);
}
```

### 2. Pipeline 层

在 `DataPipeline.execute()` 方法中，每个步骤执行前自动更新状态：

```javascript
// 更新处理状态
const processingStage = `processing_${stepConfig.name.replace(/-/g, '_')}`;
await updateProcessingStatus(processingStage);
```

处理完成后更新为 `processed`：

```javascript
await updateProcessingStatus('processed');
```

### 3. ETL 服务

`processText` 方法接收 `rawDataId` 参数，传递给 Pipeline 用于状态更新：

```javascript
const result = await pipeline.execute({
    rawDataId,
    pool: this.pool,
    // ... 其他参数
});
```

### 4. 路由层

`batch-text` 接口在处理前后更新状态：

```javascript
// 处理前：设置为清洗中
await repo.updateProcessingStatus(id, 'processing_l1_clean');

// 处理成功后：设置为处理完成
await repo.updateStatus(id, 'processed');
await repo.updateProcessingStatus(id, 'processed');
```

## 使用示例

### API 返回数据

```json
{
  "id": "rd-1774289592565-adk1q",
  "status": "processed",
  "processing_status": "processed"
}
```

### 前端辅助函数

```javascript
function getProcessingStageName(stage) {
    const names = {
        processing_l1_clean: '清洗中',
        processing_l25_fission: '裂变中',
        processing_l2_structure: '结构化中',
        processing_l3_evaluate: '评估中',
        processing_dedup: '去重中',
        processed: '处理完成'
    };
    return names[stage] || stage;
}
```

## 相关文件

### 新增文件
- `scripts/migrations/004-add-processing-status.js` - Node.js 迁移脚本
- `scripts/migrations/004-add-processing-status.sql` - SQL 迁移脚本

### 修改文件
- `src/repository/RawDataIndexRepository.js` - 新增 `updateProcessingStatus` 方法
- `src/pipeline/data-pipeline.js` - 在执行过程中更新状态
- `src/pipeline/etl-service.js` - 传递 `rawDataId` 和 `pool` 到 Pipeline
- `src/routes/raw-data.js` - 在 batch-text 接口中更新状态
- `public/raw-data.html` - 前端展示处理阶段

## 测试验证

### 1. 查看处理状态

```bash
curl http://localhost:3000/api/raw-data/list?pageSize=5 | \
  jq '.data[] | {id, status, processing_status}'
```

### 2. 查看详情

```bash
curl http://localhost:3000/api/raw-data/<ID> | \
  jq '{status, processing_status}'
```

### 3. 前端测试

1. 访问 http://localhost:3000/raw-data.html
2. 点击"批量上传"上传测试数据
3. 查看列表中"处理阶段"列
4. 点击"查看"按钮查看进度条

## 技术亮点

1. **无侵入设计**：Pipeline 通过上下文传递 `rawDataId` 和 `pool`，不强制依赖
2. **错误容错**：状态更新失败不影响 Pipeline 主流程
3. **实时反馈**：前端可通过轮询 API 实时显示处理进度
4. **视觉反馈**：脉冲动画提示处理中状态

## 后续扩展

1. **失败状态**：添加 `failed` 状态和错误信息记录
2. **进度百分比**：在 Pipeline 中报告每步的进度百分比
3. **耗时统计**：记录每个步骤的执行时间
4. **并发追踪**：支持批量处理时的并发状态追踪
