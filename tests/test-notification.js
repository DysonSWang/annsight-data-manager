/**
 * 通知服务测试脚本
 *
 * 用法：
 * 1. 设置环境变量
 * 2. node tests/test-notification.js
 */

require('dotenv').config();
const notificationService = require('../src/services/notificationService');

async function testNotification() {
    console.log('========================================');
    console.log('通知服务测试');
    console.log('========================================\n');

    // 检查配置
    console.log('配置检查:');
    console.log(`  NOTIFICATION_ENABLED: ${process.env.NOTIFICATION_ENABLED}`);
    console.log(`  NOTIFICATION_CHANNEL: ${process.env.NOTIFICATION_CHANNEL}`);
    console.log(`  DINGTALK_WEBHOOK_URL: ${process.env.DINGTALK_WEBHOOK_URL ? '已配置' : '未配置'}`);
    console.log(`  FEISHU_WEBHOOK_URL: ${process.env.FEISHU_WEBHOOK_URL ? '已配置' : '未配置'}`);
    console.log('');

    // 测试 1: 审核完成通知
    console.log('测试 1: 审核完成通知');
    const reviewResult = await notificationService.sendReviewComplete(
        {
            taskName: '情商沟通技巧训练',
            batchId: 'batch-20260326-001',
            baseUrl: process.env.BASE_URL || 'http://localhost:3000',
            notifyAll: false
        },
        {
            total: 50,
            approved: 42,
            failed: 5,
            optimized: 12
        }
    );
    console.log('结果:', JSON.stringify(reviewResult, null, 2));
    console.log('');

    // 测试 2: 人工审核待办通知
    console.log('测试 2: 人工审核待办通知');
    const manualReviewResult = await notificationService.sendManualReviewPending(
        {
            taskName: '情商沟通技巧训练',
            batchId: 'batch-20260326-001',
            baseUrl: process.env.BASE_URL || 'http://localhost:3000',
            reviewScope: 'failed'
        },
        5
    );
    console.log('结果:', JSON.stringify(manualReviewResult, null, 2));
    console.log('');

    // 测试 3: 裂变完成通知
    console.log('测试 3: 裂变完成通知');
    const fissionResult = await notificationService.sendFissionComplete(
        {
            taskName: '情商沟通技巧训练',
            batchId: 'batch-20260326-001',
            taskId: 'ft-001',
            baseUrl: process.env.BASE_URL || 'http://localhost:3000',
            fissionRequirement: '同一理念，不同场景'
        },
        {
            sourceCount: 8,
            fissionCount: 6,
            totalGenerated: 48
        }
    );
    console.log('结果:', JSON.stringify(fissionResult, null, 2));
    console.log('');

    // 测试 4: 错误告警通知
    console.log('测试 4: 错误告警通知');
    const errorResult = await notificationService.sendErrorAlert({
        title: 'AI 审核服务异常',
        type: 'service_error',
        scope: 'AI 审核模块',
        message: '连续 5 次 API 调用失败',
        suggestion: '请检查 API Key 配置和网络连接',
        critical: false
    });
    console.log('结果:', JSON.stringify(errorResult, null, 2));
    console.log('');

    console.log('========================================');
    console.log('测试完成');
    console.log('========================================');
}

// 运行测试
testNotification().catch(console.error);
