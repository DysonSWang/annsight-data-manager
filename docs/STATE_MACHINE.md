# 统一状态机管理文档

## 概述

状态机服务统一管理数据审核流程中的所有状态转换，确保数据状态的一致性和合法性。

## 状态定义

### 审核状态 (REVIEW_STATES)

| 状态 | 说明 | 触发条件 |
|------|------|----------|
| `pending` | 待审核 | 数据导入后初始状态 |
| `ai_reviewing` | AI 审核中 | 开始 AI 审核 |
| `ai_approved` | AI 通过 | AI 评分 >= 阈值 |
| `ai_failed` | AI 失败 | AI 评分 < 阈值 |
| `ai_optimizing` | AI 优化中 | 审核失败后自动优化 |
| `manual_review_pending` | 待人工审核 | AI 审核完成，等待人工确认 |
| `manual_reviewing` | 人工审核中 | 审核员开始审核 |
| `manually_approved` | 人工批准 | 审核员批准 |
| `manually_rejected` | 人工拒绝 | 审核员拒绝 |
| `final_approved` | 最终批准 | 审核流程完成 |
| `rejected` | 已拒绝 | 审核不通过 |
| `error` | 错误 | 审核过程出错 |

### 流程状态 (FLOW_STATES)

| 流程状态 | 说明 | 对应审核状态 |
|----------|------|-------------|
| `initial` | 初始状态 | pending |
| `ai_review_in_progress` | AI 审核中 | ai_reviewing |
| `ai_approved` | AI 通过 | ai_approved |
| `ai_failed` | AI 失败 | ai_failed |
| `ai_optimized` | 已优化 | ai_optimizing |
| `manual_review_in_progress` | 人工审核中 | manual_reviewing |
| `manually_approved` | 人工批准 | manually_approved |
| `manually_rejected` | 人工拒绝 | manually_rejected |
| `completed` | 已完成 | final_approved |
| `rejected` | 已拒绝 | rejected |

## 状态流转图

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
┌─────────┐    ┌────────────┐    ┌───────────┐                   │
│ pending │───▶│ ai_review  │───▶│ approved  │────────┐          │
└─────────┘    └────────────┘    └───────────┘        │          │
                    │                                  ▼          │
                    │              ┌──────────────┐  │          │
                    │              │ manual_review│◀─┘          │
                    │              └──────────────┘             │
                    │                   │    │                   │
                    ▼                   │    │                   │
              ┌──────────┐              │    │                   │
              │  failed  │──────────────┘    │                   │
              └──────────┘                   ▼                   ▼
                    │                 ┌──────────┐         ┌──────────┐
                    │                 │ approved │         │ rejected │
                    │                 └──────────┘         └──────────┘
                    ▼
              ┌──────────┐
              │ optimize │
              └──────────┘
```

## 使用方式

### 1. 在代码中验证状态转换

```javascript
const { ReviewStateMachine, REVIEW_STATES } = require('./services/reviewStateMachine');

// 验证状态转换是否合法
const result = ReviewStateMachine.canTransition(
    REVIEW_STATES.AI_REVIEWING,
    REVIEW_STATES.AI_APPROVED
);

if (result.valid) {
    // 执行状态转换
    await updateReviewStatus(dataId, REVIEW_STATES.AI_APPROVED);
} else {
    throw new Error(`非法状态转换：${result.error}`);
}
```

### 2. 获取允许的下一个状态

```javascript
// 获取当前状态可以转换到的所有状态
const nextStates = ReviewStateMachine.getNextStates(REVIEW_STATES.AI_FAILED);
console.log('AI 失败后可以转换到:', nextStates);
// 输出：['ai_optimizing', 'manual_review_pending', 'rejected']
```

### 3. 检查是否是终止状态

```javascript
// 检查数据是否已完成审核流程
const isTerminal = ReviewStateMachine.isTerminalState(currentState);
if (isTerminal) {
    console.log('审核流程已完成，可以进入下一环节');
}
```

### 4. 获取进度跟踪器

```javascript
const { ReviewProgressTracker } = require('./services/reviewStateMachine');
const tracker = new ReviewProgressTracker(pool);

// 获取批次进度
const progress = await tracker.getBatchProgress('batch-xxx');
console.log(progress);
// 输出：
// {
//     batchId: 'batch-xxx',
//     total: 100,
//     aiApproved: 75,
//     aiFailed: 20,
//     manuallyApproved: 15,
//     manuallyRejected: 5,
//     completed: 90,
//     rejected: 10,
//     aiPassRate: '75.0%',
//     finalPassRate: '90.0%',
//     progress: '100%'
// }
```

### 5. 获取待处理数量

```javascript
const pendingCounts = await tracker.getPendingCounts('batch-xxx');
console.log(pendingCounts);
// 输出：
// {
//     batchId: 'batch-xxx',
//     aiPending: 5,
//     manualPendingFailed: 15,
//     manualPendingApproved: 10,
//     totalManualPending: 25
// }
```

## 状态转换规则

### 合法转换示例

| 当前状态 | 下一个状态 | 说明 |
|----------|------------|------|
| pending | ai_reviewing | 开始 AI 审核 |
| ai_reviewing | ai_approved | AI 审核通过 |
| ai_reviewing | ai_failed | AI 审核失败 |
| ai_failed | ai_optimizing | 失败后优化 |
| ai_optimizing | ai_reviewing | 优化后重新审核 |
| ai_approved | manual_review_pending | 进入人工审核 |
| manual_review_pending | manual_reviewing | 开始人工审核 |
| manual_reviewing | manually_approved | 人工批准 |
| manually_approved | final_approved | 审核完成 |
| manual_reviewing | manually_rejected | 人工拒绝 |
| manually_rejected | rejected | 最终拒绝 |

### 非法转换示例

| 当前状态 | 尝试转换到 | 错误原因 |
|----------|------------|----------|
| pending | final_approved | 跳过所有审核步骤 |
| ai_reviewing | manual_review_pending | AI 审核未完成 |
| final_approved | ai_reviewing | 终止状态不能转换 |
| rejected | ai_approved | 需要重新从 pending 开始 |

## 集成到 RawDataReviewService

```javascript
const { ReviewStateMachine, REVIEW_STATES } = require('./reviewStateMachine');

class RawDataReviewService {
    async updateReviewStatus(dataId, nextState) {
        // 获取当前状态
        const data = await this.repo.findById(dataId);
        const currentState = data.ai_review_status;

        // 验证状态转换
        const validation = ReviewStateMachine.canTransition(currentState, nextState);
        if (!validation.valid) {
            throw new Error(`状态转换失败：${validation.error}`);
        }

        // 执行状态更新
        await this.repo.updateReviewStatus(dataId, nextState);

        // 记录状态转换日志
        logger.info(`状态转换：${dataId} ${currentState} → ${nextState}`);
    }
}
```

## API 集成

### 获取审核进度

```http
GET /api/raw-data/:batchId/progress

Response:
{
    "success": true,
    "progress": {
        "batchId": "batch-xxx",
        "total": 100,
        "aiApproved": 75,
        "aiFailed": 20,
        "manuallyApproved": 15,
        "manuallyRejected": 5,
        "completed": 90,
        "rejected": 10,
        "aiPassRate": "75.0%",
        "finalPassRate": "90.0%",
        "progress": "100%"
    }
}
```

### 获取数据状态

```http
GET /api/raw-data/:dataId/status

Response:
{
    "success": true,
    "status": {
        "dataId": "rd-xxx",
        "reviewStatus": "ai_approved",
        "reviewScore": 0.85,
        "reviewRounds": 1,
        "manualReviewStatus": "pending",
        "flowStatus": "ai_approved",
        "dataStatus": "processed",
        "isTerminal": false
    }
}
```

## 测试

运行状态机测试：

```bash
cd /home/admin/projects/annsight-data-manager
node tests/test-state-machine.js
```

## 扩展

### 添加新状态

1. 在 `REVIEW_STATES` 中定义新状态
2. 在 `STATE_TRANSITIONS` 中定义转换规则
3. 在 `getStateLabel` 中添加中文名称
4. 更新相关测试

### 添加新的流程状态

1. 在 `FLOW_STATES` 中定义新状态
2. 在 `FLOW_TRANSITIONS` 中定义转换规则
3. 在 `getFlowLabel` 中添加中文名称
4. 更新相关测试

## 注意事项

1. 所有状态转换必须经过 `canTransition` 验证
2. 终止状态（final_approved, rejected）不能有后续转换
3. 状态转换失败时抛出异常，不静默失败
4. 记录所有状态转换日志用于审计
5. 定期清理 `error` 状态的数据，重新处理或手动处理
