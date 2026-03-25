# 通知服务使用文档

## 概述

通知服务提供审核完成、人工审核待办、裂变完成等事件的消息推送功能，支持钉钉和飞书两种渠道。

## 配置

### 环境变量

在 `.env` 文件中配置以下环境变量：

```bash
# 通知服务开关
NOTIFICATION_ENABLED=true
NOTIFICATION_CHANNEL=dingtalk  # 或 feishu

# 钉钉机器人配置
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx
DINGTALK_SECRET=SECxxx

# 飞书机器人配置
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
FEISHU_SECRET=xxx

# 平台基础 URL（用于通知链接）
BASE_URL=http://localhost:3000
```

### 机器人配置

#### 钉钉机器人

1. 在钉钉群聊中添加自定义机器人
2. 获取 Webhook URL 和 Secret
3. 安全设置选择"自定义关键词"，添加关键词如"审核"、"通知"

#### 飞书机器人

1. 在飞书群聊中添加自定义机器人
2. 获取 Webhook URL
3. 开启"支持富文本消息"

## 使用方式

### 1. 在代码中使用

```javascript
const notificationService = require('./services/notificationService');

// 发送审核完成通知
await notificationService.sendReviewComplete(
    {
        taskName: '情商沟通技巧训练',
        batchId: 'batch-xxx',
        baseUrl: 'http://localhost:3000'
    },
    {
        total: 50,
        approved: 42,
        failed: 5,
        optimized: 12
    }
);

// 发送人工审核待办通知
await notificationService.sendManualReviewPending(
    {
        taskName: '情商沟通技巧训练',
        batchId: 'batch-xxx',
        baseUrl: 'http://localhost:3000',
        reviewScope: 'failed'
    },
    5 // 待审核数量
);

// 发送裂变完成通知
await notificationService.sendFissionComplete(
    {
        taskName: '情商沟通技巧训练',
        batchId: 'batch-xxx',
        taskId: 'ft-xxx',
        baseUrl: 'http://localhost:3000',
        fissionRequirement: '同一理念，不同场景'
    },
    {
        sourceCount: 8,
        fissionCount: 6,
        totalGenerated: 48
    }
);

// 发送错误告警通知
await notificationService.sendErrorAlert({
    title: 'AI 审核服务异常',
    type: 'service_error',
    scope: 'AI 审核模块',
    message: '连续 5 次 API 调用失败',
    suggestion: '请检查 API Key 配置和网络连接',
    critical: false
});
```

### 2. 在 API 中使用

导入数据时配置通知：

```json
POST /api/raw-data/batch-text

{
    "texts": [...],
    "batchId": "batch-xxx",
    "source": "import",
    "aiReviewConfig": {
        "enabled": true,
        "maxRounds": 2,
        "passThreshold": 0.75,
        "autoOptimize": true,
        "notifyOnComplete": true,
        "taskName": "情商沟通技巧训练",
        "baseUrl": "http://localhost:3000"
    }
}
```

审核完成后会自动发送通知。

### 3. 手动触发通知

```bash
# 发送人工审核待办通知
POST /api/raw-data/:batchId/notify/manual-review

{
    "taskName": "情商沟通技巧训练",
    "baseUrl": "http://localhost:3000",
    "notifyAll": false
}
```

## 通知格式

### 钉钉 Markdown 消息

```markdown
## 📊 数据审核完成

**情商沟通技巧训练** 的 AI 审核流程已完成

---

**总数据量**: 50
**审核通过**: 42 ✓
**审核失败**: 5 ✗
**优化次数**: 12
**通过率**: 84.0%

> 完成时间：2026-03-26 10:30:00

[查看审核结果](http://localhost:3000/raw-data-review.html?batch=batch-xxx)
```

### 飞书卡片消息

飞书消息使用交互式卡片格式，包含：
- 标题栏（带颜色模板）
- 内容描述
- 详细信息列表
- 操作按钮
- 底部备注

## 测试

运行测试脚本：

```bash
cd /home/admin/projects/annsight-data-manager
node tests/test-notification.js
```

## 故障排查

### 通知未发送

1. 检查 `NOTIFICATION_ENABLED` 是否为 `true`
2. 检查对应渠道的 Webhook URL 是否配置
3. 查看日志文件 `logs/combined.log` 中的错误信息

### 钉钉通知失败

1. 确认机器人安全设置中的关键词包含消息内容
2. 检查 Secret 配置是否正确
3. 确认网络可以访问 `oapi.dingtalk.com`

### 飞书通知失败

1. 确认机器人已开启"支持富文本消息"
2. 检查 Webhook URL 是否正确
3. 确认网络可以访问 `open.feishu.cn`

## 扩展

### 添加新的通知渠道

1. 在 `notificationService.js` 中添加新的发送方法
2. 在 `send()` 方法中添加渠道路由
3. 添加对应的环境变量配置

### 添加新的事件类型

1. 在 `notificationService.js` 中添加新的发送方法
2. 定义消息格式（Markdown 或卡片元素）
3. 在需要的地方调用发送方法

## 注意事项

1. 通知服务默认禁用，需要手动启用
2. 生产环境务必修改默认 Secret 和 Webhook
3. 通知发送失败不会影响主业务流程
4. 建议配置监控告警，及时发现通知服务异常
