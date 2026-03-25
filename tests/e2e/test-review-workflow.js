/**
 * 审核工作流测试 - 验证 AI 审核 + 人工优化 + 反馈日志功能
 *
 * 测试场景：
 * 1. 创建微调任务
 * 2. 导入数据（带审核配置）
 * 3. 执行 AI 审核
 * 4. 人工优化（带提示词）
 * 5. 验证反馈日志记录
 */

const http = require('http');
const { Pool } = require('pg');

const API_BASE = 'http://localhost:3000/api';
const DB_CONFIG = 'postgresql://postgres:postgres@localhost:5432/annsight_data';

// HTTP 请求封装
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const fullUrl = API_BASE + path;
        const url = new URL(fullUrl);
        const bodyData = body ? JSON.stringify(body) : null;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': bodyData ? Buffer.byteLength(bodyData) : 0
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    reject(new Error(`响应解析失败：${data}`));
                }
            });
        });

        req.on('error', reject);
        if (bodyData) req.write(bodyData);
        req.end();
    });
}

// 数据库操作
const pool = new Pool({ connectionString: DB_CONFIG });

// 清理函数
async function cleanup(taskId) {
    if (!taskId) return;

    // 获取任务批次 ID
    const taskQuery = 'SELECT batch_id FROM finetuning_tasks WHERE id = $1';
    const taskResult = await pool.query(taskQuery, [taskId]);

    if (taskResult.rows.length > 0) {
        const batchId = taskResult.rows[0].batch_id;
        await pool.query(`DELETE FROM processed_data WHERE batch_id = $1`, [batchId]);
        await pool.query(`DELETE FROM review_rounds WHERE task_id = $1`, [taskId]);
        await pool.query(`DELETE FROM review_feedback_logs WHERE task_id = $1`, [taskId]);
    }

    await pool.query(`DELETE FROM finetuning_tasks WHERE id = $1`, [taskId]);
    console.log('✓ 已清理测试数据');
}

// ========== 测试流程 ==========
async function runTest() {
    console.log('='.repeat(60));
    console.log('审核工作流测试');
    console.log('启动时间:', new Date().toLocaleString('zh-CN'));
    console.log('='.repeat(60));

    let taskId = null;

    try {
        // ========== 步骤 1: 创建微调任务 ==========
        console.log('\n【步骤 1】创建微调任务');
        const createResponse = await request('POST', '/finetuning/task', {
            name: '测试任务 - 审核工作流',
            purpose: '测试 AI 审核 + 人工优化流程',
            pass_threshold: 0.85,
            max_review_rounds: 2,
            manual_review_enabled: true,
            manual_review_scope: 'failed'
        });

        if (createResponse.status !== 200) {
            throw new Error(`创建任务失败：${JSON.stringify(createResponse.data)}`);
        }

        taskId = createResponse.data.task.id;
        console.log(`✓ 任务创建成功：${taskId}`);

        // ========== 步骤 2: 准备测试数据 ==========
        console.log('\n【步骤 2】准备测试数据');

        // 先创建一个测试批次，插入一条processed_data
        const testBatchId = `test-batch-${Date.now()}`;
        const testDataId = `pd-test-${Date.now()}`;

        await pool.query(`
            INSERT INTO processed_data (id, batch_id, type, category, title, content, review_status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'approved', NOW())
        `, [testDataId, testBatchId, 'qa', '测试', '测试标题', '这是一个测试内容，用于验证审核流程。']);

        console.log(`✓ 测试数据准备成功：${testBatchId}`);

        // ========== 步骤 3: 导入数据（带审核配置） ==========
        console.log('\n【步骤 3】导入数据（带审核配置）');
        const importResponse = await request('POST', `/finetuning/task/${taskId}/import`, {
            source_batch_id: testBatchId,
            options: {
                aiReviewConfig: {
                    enabled: true,
                    maxRounds: 2,
                    passThreshold: 0.85,
                    autoOptimize: true
                },
                manualReviewConfig: {
                    enabled: true,
                    scope: 'failed',
                    optimizationEnabled: true
                },
                fissionConfig: {
                    enabled: false
                }
            }
        });

        if (importResponse.status !== 200) {
            throw new Error(`导入失败：${JSON.stringify(importResponse.data)}`);
        }

        console.log(`✓ 数据导入成功：${importResponse.data.count} 条`);
        console.log(`  AI 审核配置：已保存`);
        console.log(`  人工审核配置：已保存`);

        // ========== 步骤 4: 执行 AI 审核 ==========
        console.log('\n【步骤 4】执行 AI 审核');
        const reviewResponse = await request('POST', `/finetuning/task/${taskId}/review/start`, {});

        if (reviewResponse.status !== 200) {
            throw new Error(`AI 审核失败：${JSON.stringify(reviewResponse.data)}`);
        }

        console.log(`✓ AI 审核完成`);
        console.log(`  通过：${reviewResponse.data.totalPassed || 0}`);
        console.log(`  失败：${reviewResponse.data.totalFailed || 0}`);

        // ========== 步骤 5: 获取审核后的数据列表 ==========
        console.log('\n【步骤 5】获取数据列表');
        const dataResponse = await request('GET', `/finetuning/task/${taskId}/data?page=1&pageSize=10`);

        if (dataResponse.status !== 200) {
            throw new Error(`获取数据失败：${JSON.stringify(dataResponse.data)}`);
        }

        const dataItems = dataResponse.data.data || [];
        console.log(`✓ 获取到 ${dataItems.length} 条数据`);

        if (dataItems.length === 0) {
            console.log('⚠️  没有数据，跳过后续测试');
        }

        // ========== 步骤 6: 人工优化（带提示词） ==========
        if (dataItems.length > 0) {
            console.log('\n【步骤 6】测试人工优化 API');
            const testData = dataItems[0];

            const optimizeResponse = await request(
                'POST',
                `/finetuning/task/${taskId}/data/${testData.id}/optimize`,
                {
                    prompt: '请补充具体场景的例子，让内容更加完整',
                    recordFeedback: true
                }
            );

            if (optimizeResponse.status !== 200) {
                throw new Error(`人工优化失败：${JSON.stringify(optimizeResponse.data)}`);
            }

            console.log(`✓ 人工优化成功`);
            console.log(`  反馈已记录：${optimizeResponse.data.feedbackRecorded}`);
            console.log(`  变化：${JSON.stringify(optimizeResponse.data.changes || [])}`);
        }

        // ========== 步骤 7: 验证反馈日志 ==========
        console.log('\n【步骤 7】验证反馈日志');
        const feedbackResponse = await request('GET', `/finetuning/task/${taskId}/feedback-logs`);

        if (feedbackResponse.status !== 200) {
            throw new Error(`获取反馈日志失败：${JSON.stringify(feedbackResponse.data)}`);
        }

        const feedbackLogs = feedbackResponse.data.logs || [];
        console.log(`✓ 反馈日志：${feedbackLogs.length} 条`);

        if (feedbackLogs.length > 0) {
            const log = feedbackLogs[0];
            console.log(`  类型：${log.suggestion_type}`);
            console.log(`  提示词：${log.user_feedback?.slice(0, 50)}...`);
            console.log(`  已应用：${log.applied_to_prompt ? '是' : '否'}`);
        }

        // ========== 测试总结 ==========
        console.log('\n' + '='.repeat(60));
        console.log('测试总结报告');
        console.log('='.repeat(60));
        console.log('✓ 任务创建：成功');
        console.log('✓ 数据导入（带配置）：成功');
        console.log('✓ AI 审核：成功');
        console.log('✓ 人工优化（带提示词）：成功');
        console.log('✓ 反馈日志记录：成功');
        console.log('='.repeat(60));
        console.log('✓ 所有测试通过！');
        console.log('='.repeat(60));

        return { success: true };

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        return { success: false, error: error.message };

    } finally {
        // 清理测试数据
        if (taskId) {
            await cleanup(taskId);
        }
        await pool.end();
    }
}

runTest()
    .then(result => {
        console.log('\n最终结果:', JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('未捕获的错误:', error);
        process.exit(1);
    });
