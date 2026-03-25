/**
 * 通知服务集成测试
 * 测试审核流程中的通知功能
 */

require('dotenv').config();
const { Pool } = require('pg');
const RawDataReviewService = require('../src/services/RawDataReviewService');
const notificationService = require('../src/services/notificationService');

// 测试配置
const TEST_CONFIG = {
    batchId: 'test-batch-' + Date.now(),
    taskName: '测试任务 - 通知服务',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000'
};

async function setupDatabase() {
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'annsight',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres'
    });

    // 创建测试数据
    const createQuery = `
        INSERT INTO raw_data_index (id, oss_url, content_type, source, batch_id, transcript_text, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
    `;

    const testData = [
        { id: 'test-data-1', text: '这是一条测试数据，内容完整，表达清晰。' },
        { id: 'test-data-2', text: '另一条测试数据，用于验证通知功能。' },
        { id: 'test-data-3', text: '第三条测试数据，内容较短。' }
    ];

    for (const data of testData) {
        await pool.query(createQuery, [
            data.id,
            '',
            'text/plain',
            'test',
            TEST_CONFIG.batchId,
            data.text,
            'pending'
        ]);
    }

    console.log(`创建 ${testData.length} 条测试数据`);
    return pool;
}

async function testNotificationIntegration() {
    console.log('========================================');
    console.log('通知服务集成测试');
    console.log('========================================\n');

    // 测试 1: 模拟审核完成通知
    console.log('测试 1: 模拟审核完成通知');
    const reviewResult = await notificationService.sendReviewComplete(
        {
            taskName: TEST_CONFIG.taskName,
            batchId: TEST_CONFIG.batchId,
            baseUrl: TEST_CONFIG.baseUrl
        },
        {
            total: 10,
            approved: 8,
            failed: 2,
            optimized: 3
        }
    );
    console.log('审核完成通知结果:', reviewResult);
    console.log('');

    // 测试 2: 模拟人工审核待办通知
    console.log('测试 2: 模拟人工审核待办通知');
    const manualReviewResult = await notificationService.sendManualReviewPending(
        {
            taskName: TEST_CONFIG.taskName,
            batchId: TEST_CONFIG.batchId,
            baseUrl: TEST_CONFIG.baseUrl,
            reviewScope: 'failed'
        },
        2
    );
    console.log('人工审核待办通知结果:', manualReviewResult);
    console.log('');

    // 测试 3: 模拟错误告警通知
    console.log('测试 3: 模拟错误告警通知');
    const errorAlertResult = await notificationService.sendErrorAlert({
        title: '测试告警 - AI 审核异常',
        type: 'test_alert',
        scope: '测试模块',
        message: '这是一条测试告警消息',
        suggestion: '验证通知服务是否正常工作',
        critical: false
    });
    console.log('错误告警通知结果:', errorAlertResult);
    console.log('');

    // 测试 4: 完整审核流程通知
    console.log('测试 4: 完整审核流程（带通知）');
    try {
        const pool = await setupDatabase();
        const reviewService = new RawDataReviewService(pool);

        // 启动 AI 审核（启用通知）
        const result = await reviewService.startAiReview(TEST_CONFIG.batchId, {
            maxRounds: 1,
            passThreshold: 0.75,
            autoOptimize: false,
            notifyOnComplete: true,
            taskName: TEST_CONFIG.taskName,
            baseUrl: TEST_CONFIG.baseUrl
        });

        console.log('审核流程结果:', result.summary);
        console.log('通知已自动发送');

        // 清理测试数据
        await pool.query('DELETE FROM raw_data_index WHERE batch_id = $1', [TEST_CONFIG.batchId]);
        await pool.end();

    } catch (error) {
        console.error('完整审核流程测试失败:', error.message);
    }
    console.log('');

    console.log('========================================');
    console.log('集成测试完成');
    console.log('========================================');
}

// 运行测试
testNotificationIntegration().catch(console.error);
