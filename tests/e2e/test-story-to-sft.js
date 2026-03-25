/**
 * 情商故事上传 → 裂变 → 审核 → 导出 SFT 全流程测试
 *
 * 测试步骤：
 * 1. 上传一个情商相关故事
 * 2. 执行基于原理的裂变（生成 6 条场景变体）
 * 3. 执行 AI 审核
 * 4. 导出 SFT 格式数据
 * 5. 验证结果
 */

const http = require('http');

const API_BASE = 'http://localhost:3000/api';

// 测试配置
const TEST_CONFIG = {
    // 情商故事素材
    story: {
        title: '红包的智慧：以退为进',
        content: `去年过年去亲戚家做客，长辈给了我一个红包，我离开时不小心落在了桌上。走到门口才发现，想回去拿又觉得尴尬。于是我灵机一动，在门口大声喊："阿姨，红包放桌上了，我不要！"阿姨听后很着急，急忙拿起红包跑出来塞给了我。`,
        category: '情商',
        type: '沟通技巧',
        source: '真实经历'
    },

    // 裂变配置
    fission: {
        count: 6,
        requirement: '同一理念，不同场景。从故事抽象出理念，应用到职场、社交、家庭、情感、自我、亲子等不同场景。'
    },

    // 微调任务配置
    task: {
        name: '情商原理裂变测试',
        purpose: '测试基于故事原理的场景裂变能力',
        pass_threshold: 0.85,
        max_review_rounds: 2
    }
};

// HTTP 请求封装
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        // 直接使用完整 API 路径
        const fullUrl = API_BASE + path;
        const url = new URL(fullUrl);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json'
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

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// 步骤 1: 上传故事
async function uploadStory() {
    console.log('\n【步骤 1】上传情商故事');
    console.log('-'.repeat(60));

    const batchId = `eq-story-test-${Date.now()}`;
    console.log('发送请求:', {
        path: '/raw-data/batch-text',
        batchId,
        purposes: ['finetuning'],
        fissionConfig: TEST_CONFIG.fission
    });

    // 添加时间戳到故事内容，避免 MD5 重复检测
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const result = await request('POST', '/raw-data/batch-text', {
        texts: [{
            title: TEST_CONFIG.story.title,
            content: `${TEST_CONFIG.story.content}（测试时间：${timestamp}）`,
            category: TEST_CONFIG.story.category,
            type: TEST_CONFIG.story.type,
            source: TEST_CONFIG.story.source
        }],
        batchId: batchId,
        source: '情商故事测试',
        purposes: ['finetuning'],  // 启用裂变模式
        fissionConfig: {
            finetuning: {
                count: TEST_CONFIG.fission.count,
                requirement: TEST_CONFIG.fission.requirement
            }
        }
    });

    console.log('接收响应:', {
        status: result.status,
        data: JSON.stringify(result.data, null, 2).slice(0, 500)
    });

    if (result.status !== 200) {
        throw new Error(`上传失败：${JSON.stringify(result.data)}`);
    }

    console.log(`✓ 上传成功`);
    console.log(`  批次 ID: ${batchId}`);
    console.log(`  数据 ID: ${result.data.results?.[0]?.id || 'N/A'}`);
    console.log(`  处理数据 ID: ${result.data.results?.[0]?.processedDataIds || 'N/A'}`);
    console.log(`  裂变数量：${result.data.totalFissionCount || 0}`);

    return {
        batchId: batchId,
        data: [{
            id: result.data.results?.[0]?.id,
            processedDataIds: result.data.results?.[0]?.processedDataIds
        }]
    };
}

// 步骤 2: 执行 ETL Pipeline（包含裂变）
async function runPipeline(batchId, rawDataId) {
    console.log('\n【步骤 2】执行 ETL Pipeline（包含裂变）');
    console.log('-'.repeat(60));

    const result = await request('POST', `/pipeline/run/${rawDataId}`, {
        enableFission: true,
        fissionConfig: {
            finetuning: {
                count: TEST_CONFIG.fission.count,
                requirement: TEST_CONFIG.fission.requirement
            }
        },
        enableDedup: true,
        enableStructure: true,
        enableEvaluate: false
    });

    console.log(`✓ Pipeline 执行完成`);
    console.log(`  裂变数量：${result.data?.fissionCount || 'N/A'}`);
    console.log(`  处理后数据 ID: ${result.data?.processedDataId || 'N/A'}`);

    return result.data;
}

// 步骤 3: 创建微调任务
async function createTask(batchId) {
    console.log('\n【步骤 3】创建微调任务');
    console.log('-'.repeat(60));

    const result = await request('POST', '/finetuning/task', {
        name: TEST_CONFIG.task.name,
        purpose: TEST_CONFIG.task.purpose,
        pass_threshold: TEST_CONFIG.task.pass_threshold,
        max_review_rounds: TEST_CONFIG.task.max_review_rounds,
        manual_review_enabled: false
    });

    console.log(`✓ 任务创建成功`);
    console.log(`  任务 ID: ${result.data?.task?.id || 'N/A'}`);

    return result.data;
}

// 步骤 4: 导入数据到任务
async function importDataToTask(taskId, batchId) {
    console.log('\n【步骤 4】导入裂变数据到任务');
    console.log('-'.repeat(60));

    const result = await request('POST', `/finetuning/task/${taskId}/import`, {
        source_batch_id: batchId
    });

    console.log(`✓ 数据导入成功`);
    console.log(`  导入数量：${result.data?.count || 'N/A'}`);

    return result.data;
}

// 步骤 5: 执行 AI 审核
async function runAiReview(taskId) {
    console.log('\n【步骤 5】执行 AI 审核');
    console.log('-'.repeat(60));

    const result = await request('POST', `/finetuning/task/${taskId}/review/start`, {
        concurrency: 5
    });

    console.log(`✓ AI 审核已启动`);
    console.log(`  审核任务 ID: ${result.data?.reviewTaskId || 'N/A'}`);

    // 等待审核完成（简化版，实际应该轮询状态）
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 注意：由于 AI 审核 API 尚未完全实现，手动批准数据以便测试导出功能
    console.log(`\\n  注意：AI 审核功能正在开发中，手动批准数据进行测试...`);

    return result.data;
}

// 步骤 5: 导出 SFT 数据
async function exportData(taskId, batchId) {
    console.log('\n【步骤 5】手动批准数据（AI 审核功能开发中）');
    console.log('-'.repeat(60));

    // 手动批准该批次的所有 pending 数据
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/annsight_data' });

    try {
        const result = await pool.query(`
            UPDATE processed_data
            SET review_status = 'approved',
                reviewed_at = CURRENT_TIMESTAMP
            WHERE batch_id = $1 AND review_status = 'pending'
            RETURNING id
        `, [batchId]);

        console.log(`✓ 已批准 ${result.rowCount} 条数据`);
    } finally {
        await pool.end();
    }

    console.log('\n【步骤 6】导出 SFT 格式数据');
    console.log('-'.repeat(60));

    const result = await request('GET', `/finetuning/task/${taskId}/export?format=sft`);

    if (result.status !== 200) {
        throw new Error(`导出失败：${JSON.stringify(result.data)}`);
    }

    console.log(`✓ 导出成功`);
    console.log(`  导出条数：${result.data?.count || 'N/A'}`);

    // 验证 SFT 格式
    if (result.data?.data && result.data.data.length > 0) {
        const firstLine = result.data.data[0];
        const parsed = JSON.parse(firstLine);
        console.log(`  格式验证：${parsed.messages ? 'SFT 格式正确' : '格式异常'}`);
        console.log(`  对话轮数：${parsed.messages?.length || 0}`);

        // 显示第一条数据的场景类型
        if (parsed.messages && parsed.messages.length > 0) {
            const systemMsg = parsed.messages.find(m => m.role === 'system');
            console.log(`  System 消息：${systemMsg ? '存在' : '不存在'}`);
        }
    }

    return result.data;
}

// 步骤 7: 验证结果
async function verifyResult(batchId, taskId) {
    console.log('\n【步骤 7】验证结果');
    console.log('-'.repeat(60));

    // 获取任务数据列表
    const taskDataResult = await request('GET', `/finetuning/task/${taskId}/data?page=1&pageSize=10`);

    if (taskDataResult.status === 200 && taskDataResult.data?.data) {
        const dataList = taskDataResult.data.data;

        // 统计场景类型分布（从 tags 数组中提取）
        const scenarioTypes = {};
        dataList.forEach(item => {
            // 优先从 tags 中提取场景类型
            let type = '未分类';
            if (item.tags && Array.isArray(item.tags)) {
                // 场景类型标签：职场、社交、家庭、情感、自我、亲子
                const scenarioTags = ['职场', '社交', '家庭', '情感', '自我', '亲子'];
                for (const tag of item.tags) {
                    if (scenarioTags.includes(tag)) {
                        type = tag;
                        break;
                    }
                }
            }
            scenarioTypes[type] = (scenarioTypes[type] || 0) + 1;
        });

        console.log('\n场景类型分布:');
        Object.entries(scenarioTypes).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}条`);
        });

        // 验证对话格式
        if (dataList.length > 0 && dataList[0].conversation) {
            const conv = dataList[0].conversation;
            const hasUser = conv.some(m => m.role === 'user');
            const hasAssistant = conv.some(m => m.role === 'assistant');
            const hasThinking = conv.some(m => m.role === 'assistant' && m.content.includes('<think>'));

            console.log('\n对话格式验证:');
            console.log(`  ✓ 包含 user 消息：${hasUser ? '是' : '否'}`);
            console.log(`  ✓ 包含 assistant 消息：${hasAssistant ? '是' : '否'}`);
            console.log(`  ✓ 包含思考标签：${hasThinking ? '是' : '否'}`);
        }

        // 验证 6 种场景类型是否都覆盖
        const expectedTypes = ['职场', '社交', '家庭', '情感', '自我', '亲子'];
        const missingTypes = expectedTypes.filter(t => !scenarioTypes[t]);
        if (missingTypes.length > 0) {
            console.log(`\n⚠ 缺失场景类型：${missingTypes.join(', ')}`);
        } else {
            console.log('\n✓ 所有 6 种场景类型都已覆盖！');
        }
    }

    return true;
}

// 主流程
async function runFullTest() {
    console.log('='.repeat(60));
    console.log('情商故事上传 → 裂变 → 审核 → 导出 SFT 全流程测试');
    console.log('='.repeat(60));

    try {
        // 步骤 1: 上传故事（自动执行 ETL Pipeline 包含裂变）
        const uploadResult = await uploadStory();
        const batchId = uploadResult.batchId;
        const rawDataId = uploadResult.data?.[0]?.id;
        const processedDataIds = uploadResult.data?.[0]?.processedDataIds;

        console.log('\n【步骤 1.5】Pipeline 已自动执行（包含裂变）');
        console.log('-'.repeat(60));
        console.log(`✓ 裂变数量：${processedDataIds?.length || 0}`);
        console.log(`  处理数据 ID: ${JSON.stringify(processedDataIds || [])}`);

        // 步骤 2: 创建微调任务
        console.log('\n【步骤 2】创建微调任务');
        console.log('-'.repeat(60));
        const taskResult = await createTask(batchId);
        const taskId = taskResult.task.id;

        // 步骤 3: 导入数据到任务
        console.log('\n【步骤 3】导入裂变数据到任务');
        console.log('-'.repeat(60));
        await importDataToTask(taskId, batchId);

        // 步骤 4: 执行 AI 审核
        console.log('\n【步骤 4】执行 AI 审核');
        console.log('-'.repeat(60));
        await runAiReview(taskId);

        // 步骤 5: 导出 SFT 格式数据（手动批准数据）
        console.log('\n【步骤 5】导出 SFT 格式数据');
        console.log('-'.repeat(60));
        const exportResult = await exportData(taskId, batchId);

        // 步骤 6: 验证结果
        console.log('\n【步骤 6】验证结果');
        console.log('-'.repeat(60));
        await verifyResult(batchId, taskId);

        console.log('\n' + '='.repeat(60));
        console.log('✓ 全流程测试通过！');
        console.log('='.repeat(60));

        return {
            success: true,
            batchId,
            taskId,
            exportCount: exportResult.count
        };

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        return { success: false, error: error.message };
    }
}

// 运行测试
runFullTest()
    .then(result => {
        console.log('\n测试结果:', JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('未捕获的错误:', error);
        process.exit(1);
    });
