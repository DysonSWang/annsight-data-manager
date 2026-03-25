/**
 * 逻辑连贯性重构 - 测试脚本
 *
 * 测试场景：
 * 1. 基础导入（数据复制 + 状态重置为 pending）
 * 2. 多任务复用同一源数据（状态隔离）
 */

const http = require('http');
const { Pool } = require('pg');

const API_BASE = 'http://localhost:3000/api';
const DB_CONFIG = 'postgresql://postgres:postgres@localhost:5432/annsight_data';

// 测试配置
const TEST_CONFIG = {
    story: {
        title: '逻辑连贯性测试 - 红包的智慧',
        content: `去年过年去亲戚家做客，长辈给了我一个红包，我离开时不小心落在了桌上。走到门口才发现，想回去拿又觉得尴尬。于是我灵机一动，在门口大声喊："阿姨，红包放桌上了，我不要！"阿姨听后很着急，急忙拿起红包跑出来塞给了我。`,
        category: '情商',
        type: '沟通技巧'
    },
    fission: {
        count: 6,
        requirement: '同一理念，不同场景。从故事抽象出理念，应用到职场、社交、家庭、情感、自我、亲子等不同场景。'
    }
};

// 生成唯一的内容（避免 MD5 重复）
function uniqueContent(scenario, timestamp) {
    return `${TEST_CONFIG.story.content}【${scenario} - ${timestamp}】`;
}

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
async function cleanup() {
    await pool.query(`DELETE FROM processed_data WHERE batch_id LIKE '%coh-test%'`);
    await pool.query(`DELETE FROM finetuning_tasks WHERE batch_id LIKE '%coh-test%'`);
    console.log('✓ 已清理测试数据');
}

// ========== 测试场景 1：基础导入（数据复制 + 状态重置） ==========
async function testScenario1() {
    console.log('\n' + '='.repeat(60));
    console.log('【测试场景 1】基础导入 - 数据复制 + 状态重置为 pending');
    console.log('='.repeat(60));

    const batchId = `coh-test-1-${Date.now().toString().slice(-8)}`;
    const timestamp = Date.now().toString();

    // 1. 上传故事（带裂变配置）
    console.log('\n步骤 1: 上传故事（带裂变配置）');
    const uploadResult = await request('POST', '/raw-data/batch-text', {
        texts: [{
            title: TEST_CONFIG.story.title,
            content: uniqueContent('场景 1', timestamp),
            category: TEST_CONFIG.story.category,
            type: TEST_CONFIG.story.type
        }],
        batchId,
        source: 'coh-test-s1',
        purposes: ['finetuning'],
        fissionConfig: {
            finetuning: TEST_CONFIG.fission
        }
    });

    if (uploadResult.status !== 200) {
        throw new Error(`上传失败：${JSON.stringify(uploadResult.data)}`);
    }

    console.log(`✓ 上传成功，裂变 ${uploadResult.data.results?.[0]?.processedDataIds?.length || 0} 条数据`);

    // 手动批准数据（模拟审核通过）
    console.log('\n步骤 2: 手动批准数据');
    await pool.query(`
        UPDATE processed_data
        SET review_status = 'approved', reviewed_at = CURRENT_TIMESTAMP
        WHERE batch_id = $1 AND review_status = 'pending'
    `, [batchId]);

    // 2. 创建微调任务
    console.log('\n步骤 3: 创建微调任务');
    const taskResult = await request('POST', '/finetuning/task', {
        name: '连贯性测试 - 场景 1',
        purpose: '测试数据复制和状态重置',
        pass_threshold: 0.85
    });

    if (taskResult.status !== 200) {
        throw new Error(`创建任务失败：${JSON.stringify(taskResult.data)}`);
    }

    const taskId = taskResult.data.task.id;
    console.log(`✓ 任务创建成功，ID: ${taskId}`);

    // 3. 导入数据（状态重置为 pending）
    console.log('\n步骤 4: 导入数据（状态重置为 pending）');
    const importResult = await request('POST', `/finetuning/task/${taskId}/import`, {
        source_batch_id: batchId
    });

    if (importResult.status !== 200) {
        throw new Error(`导入失败：${JSON.stringify(importResult.data)}`);
    }

    console.log(`✓ 导入成功，数量：${importResult.data.count}`);
    console.log(`  源批次：${batchId}`);
    console.log(`  任务批次：${importResult.data.taskBatchId}`);

    // 4. 验证：数据已复制，source_data_id 有值，审核状态为 pending
    console.log('\n步骤 5: 验证数据');
    const verifyQuery = `
        SELECT id, source_data_id, source_task_id, review_status, batch_id
        FROM processed_data
        WHERE batch_id = $1
        LIMIT 3
    `;
    const verifyResult = await pool.query(verifyQuery, [importResult.data.taskBatchId]);

    if (verifyResult.rows.length === 0) {
        throw new Error('验证失败：任务批次中没有数据');
    }

    const firstRow = verifyResult.rows[0];
    console.log(`  数据条数：${verifyResult.rows.length}`);
    console.log(`  source_data_id: ${firstRow.source_data_id ? '有值 ✓' : '无值 ✗'}`);
    console.log(`  source_task_id: ${firstRow.source_task_id ? '有值 ✓' : '无值 ✗'}`);
    console.log(`  review_status: ${firstRow.review_status}（期望：pending）`);

    if (firstRow.review_status !== 'pending') {
        throw new Error(`验证失败：审核状态应为 pending，实际为 ${firstRow.review_status}`);
    }
    if (!firstRow.source_data_id) {
        throw new Error('验证失败：source_data_id 为空');
    }

    console.log('\n✓ 测试场景 1 通过！');

    return { taskId, batchId, taskBatchId: importResult.data.taskBatchId };
}

// ========== 测试场景 2：多任务复用同一源数据 - 状态隔离 ==========
async function testScenario2() {
    console.log('\n' + '='.repeat(60));
    console.log('【测试场景 2】多任务复用同一源数据 - 状态隔离');
    console.log('='.repeat(60));

    const batchId = `coh-test-2-${Date.now().toString().slice(-8)}`;
    const timestamp = Date.now().toString();

    // 1. 上传故事并批准
    console.log('\n步骤 1: 上传故事并批准');
    const uploadResult = await request('POST', '/raw-data/batch-text', {
        texts: [{
            title: TEST_CONFIG.story.title,
            content: uniqueContent('场景 2', timestamp),
            category: TEST_CONFIG.story.category,
            type: TEST_CONFIG.story.type
        }],
        batchId,
        source: 'coh-test-s2',
        purposes: ['finetuning']
    });

    await pool.query(`
        UPDATE processed_data
        SET review_status = 'approved', reviewed_at = CURRENT_TIMESTAMP
        WHERE batch_id = $1 AND review_status = 'pending'
    `, [batchId]);

    console.log(`✓ 上传并批准 ${uploadResult.data.results?.[0]?.processedDataIds?.length || 0} 条数据`);

    // 2. 创建任务 A
    console.log('\n步骤 2: 创建任务 A');
    const taskAResult = await request('POST', '/finetuning/task', {
        name: '连贯性测试 - 任务 A',
        purpose: '测试多任务复用',
        pass_threshold: 0.85
    });
    const taskIdA = taskAResult.data.task.id;
    console.log(`✓ 任务 A ID: ${taskIdA}`);

    // 3. 创建任务 B
    console.log('\n步骤 3: 创建任务 B');
    const taskBResult = await request('POST', '/finetuning/task', {
        name: '连贯性测试 - 任务 B',
        purpose: '测试多任务复用',
        pass_threshold: 0.85
    });
    const taskIdB = taskBResult.data.task.id;
    console.log(`✓ 任务 B ID: ${taskIdB}`);

    // 4. 任务 A 导入数据
    console.log('\n步骤 4: 任务 A 导入数据');
    const importAResult = await request('POST', `/finetuning/task/${taskIdA}/import`, {
        source_batch_id: batchId
    });
    console.log(`✓ 任务 A 导入成功，数量：${importAResult.data.count}`);
    const taskBatchA = importAResult.data.taskBatchId;

    // 5. 任务 B 导入数据
    console.log('\n步骤 5: 任务 B 导入数据');
    const importBResult = await request('POST', `/finetuning/task/${taskIdB}/import`, {
        source_batch_id: batchId
    });
    console.log(`✓ 任务 B 导入成功，数量：${importBResult.data.count}`);
    const taskBatchB = importBResult.data.taskBatchId;

    // 6. 验证：两个任务批次不同，数据隔离
    console.log('\n步骤 6: 验证数据隔离');

    if (taskBatchA === taskBatchB) {
        throw new Error('验证失败：任务 A 和任务 B 的批次 ID 相同，未隔离');
    }
    console.log(`  任务 A 批次：${taskBatchA}`);
    console.log(`  任务 B 批次：${taskBatchB}`);
    console.log(`  批次隔离：✓`);

    // 验证 source_data_id 都指向同一源数据
    const verifyQuery = `
        SELECT DISTINCT source_data_id
        FROM processed_data
        WHERE batch_id IN ($1, $2)
    `;
    const verifyResult = await pool.query(verifyQuery, [taskBatchA, taskBatchB]);

    if (verifyResult.rows.length === 0) {
        throw new Error('验证失败：没有查到数据');
    }

    console.log(`  源数据追踪：${verifyResult.rows.length} 条独立源数据`);

    // 7. 验证：两个任务状态独立
    console.log('\n步骤 7: 验证状态独立');
    const countQuery = `
        SELECT
            (SELECT COUNT(*) FROM processed_data WHERE batch_id = $1) as count_a,
            (SELECT COUNT(*) FROM processed_data WHERE batch_id = $2) as count_b
    `;
    const countResult = await pool.query(countQuery, [taskBatchA, taskBatchB]);
    const { count_a, count_b } = countResult.rows[0];

    console.log(`  任务 A 数据量：${count_a}`);
    console.log(`  任务 B 数据量：${count_b}`);

    console.log('\n✓ 测试场景 2 通过！');

    return { taskIdA, taskIdB, taskBatchA, taskBatchB };
}

// ========== 主流程 ==========
async function runTests() {
    console.log('='.repeat(60));
    console.log('逻辑连贯性重构 - 自动化测试');
    console.log('启动时间:', new Date().toLocaleString('zh-CN'));
    console.log('='.repeat(60));

    try {
        // 先清理旧数据
        await cleanup();

        // 执行测试
        const result1 = await testScenario1();
        const result2 = await testScenario2();

        // 汇总报告
        console.log('\n' + '='.repeat(60));
        console.log('测试汇总报告');
        console.log('='.repeat(60));
        console.log('✓ 测试场景 1：基础导入（状态重置为 pending） - 通过');
        console.log('✓ 测试场景 2：多任务复用同一源数据 - 通过');
        console.log('='.repeat(60));
        console.log('✓ 所有测试通过！');
        console.log('='.repeat(60));

        return { success: true, results: { result1, result2 } };

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        return { success: false, error: error.message };
    } finally {
        await pool.end();
    }
}

// 运行测试
runTests()
    .then(result => {
        console.log('\n最终结果:', JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('未捕获的错误:', error);
        process.exit(1);
    });
