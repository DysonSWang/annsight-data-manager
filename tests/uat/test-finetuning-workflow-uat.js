#!/usr/bin/env node
/**
 * 微调任务工作流程 UAT 测试脚本
 * 用法：node tests/uat/test-finetuning-workflow-uat.js
 */

const axios = require('axios');
require('dotenv').config();

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api/finetuning';

// 测试配置
const TEST_CONFIG = {
    name: `UAT 测试任务-${Date.now()}`,
    purpose: '用于测试微调数据审核优化流程',
    pass_threshold: 0.85,
    max_review_rounds: 2,
    manual_review_enabled: true,
    manual_review_scope: 'failed'
};

// 测试数据
const TEST_DATA = [
    {
        type: '教训案例',
        category: '职场',
        title: '如何避免在工作中踩坑',
        content: '在职场工作中，避免踩坑是非常重要的。首先，要了解公司的规章制度和流程，其次，要多向老员工请教，最后，要保持谨慎的态度。'
    },
    {
        type: '战术方法',
        category: '社交',
        title: '有效沟通的三个步骤',
        content: '第一步：倾听对方说话，理解对方的需求。第二步：清晰表达自己的想法，避免模糊。第三步：达成共识，确认双方理解一致。'
    },
    {
        type: '沟通技巧',
        category: '情感',
        title: '如何处理亲密关系中的冲突',
        content: '冲突是亲密关系中不可避免的一部分。处理冲突的关键是：控制情绪、积极倾听、表达感受而非指责、寻求共同解决方案。'
    }
];

// 测试结果
const testResults = {
    taskId: null,
    dataIds: [],
    steps: []
};

function log(message, type = 'info') {
    const prefix = {
        info: 'ℹ️',
        success: '✅',
        error: '❌',
        warning: '⚠️'
    }[type] || 'ℹ️';
    console.log(`${prefix} ${message}`);
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
    console.log('='.repeat(60));
    console.log('🧪 微调任务工作流程 UAT 测试');
    console.log('='.repeat(60));

    try {
        // Step 1: 创建任务
        log('步骤 1: 创建微调任务');
        const createResponse = await axios.post(`${API_BASE}/task`, TEST_CONFIG);
        testResults.taskId = createResponse.data.task.id;
        const taskBatchId = createResponse.data.task.batch_id;  // 获取任务创建时的 batch_id
        log(`任务创建成功：${testResults.taskId}, batch_id: ${taskBatchId}`, 'success');
        testResults.steps.push({ step: '创建任务', status: 'success' });

        // Step 2: 导入测试数据（使用任务的 batch_id 创建数据）
        log('步骤 2: 导入测试数据');

        // 通过 raw-data API 创建数据到任务的 batch_id
        const rawDataResponse = await axios.post('http://localhost:3000/api/raw-data/batch-text', {
            texts: TEST_DATA.map(d => `${d.title}\n\n${d.content}`),
            batchId: taskBatchId,  // 使用任务创建时的 batch_id
            source: 'uat_test',
            purposes: ['finetuning']  // 启用裂变模式，生成微调数据
        });

        log(`数据导入成功：${rawDataResponse.data.successCount}/${rawDataResponse.data.total}`, 'success');
        testResults.steps.push({ step: '导入数据', status: 'success' });

        // Step 3: 获取任务数据
        log('步骤 3: 获取任务数据');
        const dataResponse = await axios.get(`${API_BASE}/task/${testResults.taskId}/data`);
        testResults.dataIds = dataResponse.data.data.map(d => d.id);
        log(`获取到 ${testResults.dataIds.length} 条数据`, 'success');
        testResults.steps.push({ step: '获取数据', status: 'success' });

        // Step 4: 启动 AI 审核
        log('步骤 4: 启动 AI 审核（这可能需要一些时间）');
        const reviewResponse = await axios.post(`${API_BASE}/task/${testResults.taskId}/review/start`, {
            concurrency: 5
        });
        log(`AI 审核完成：通过 ${reviewResponse.data.passed}, 失败 ${reviewResponse.data.failed}`, 'success');
        testResults.steps.push({ step: 'AI 审核', status: 'success', result: reviewResponse.data });

        // Step 5: 获取审核进度
        log('步骤 5: 获取审核进度');
        const progressResponse = await axios.get(`${API_BASE}/task/${testResults.taskId}/review/status`);
        log(`审核进度：${JSON.stringify(progressResponse.data.stats)}`, 'success');
        testResults.steps.push({ step: '获取进度', status: 'success' });

        // Step 6: 启动 AI 优化（如果有失败的数据）
        if (reviewResponse.data.failed > 0) {
            log('步骤 6: 启动 AI 优化');
            const optimizeResponse = await axios.post(`${API_BASE}/task/${testResults.taskId}/optimize/start`);
            log(`AI 优化完成：${optimizeResponse.data.optimized}/${optimizeResponse.data.total}`, 'success');
            testResults.steps.push({ step: 'AI 优化', status: 'success', result: optimizeResponse.data });

            // Step 7: 重新审核
            log('步骤 7: 重新启动 AI 审核');
            const reReviewResponse = await axios.post(`${API_BASE}/task/${testResults.taskId}/review/start`);
            log(`重新审核完成`, 'success');
            testResults.steps.push({ step: '重新审核', status: 'success' });
        } else {
            log('跳过 AI 优化（所有数据已通过审核）', 'warning');
        }

        // Step 8: 启动人工审核
        log('步骤 8: 启动人工审核');
        const manualResponse = await axios.post(`${API_BASE}/task/${testResults.taskId}/manual-review/start`);
        log(`人工审核启动：${manualResponse.data.count} 条数据`, 'success');
        testResults.steps.push({ step: '人工审核', status: 'success' });

        // Step 9: 获取人工审核列表
        log('步骤 9: 获取人工审核列表');
        const manualListResponse = await axios.get(`${API_BASE}/task/${testResults.taskId}/manual-review/list`);
        log(`获取到 ${manualListResponse.data.data.length} 条待人工审核数据`, 'success');
        testResults.steps.push({ step: '获取人工审核列表', status: 'success' });

        // 测试完成
        console.log('\n' + '='.repeat(60));
        log('🎉 测试全部通过!', 'success');
        console.log('='.repeat(60));

        // 输出测试结果摘要
        console.log('\n📊 测试结果摘要:');
        console.log(`   任务 ID: ${testResults.taskId}`);
        console.log(`   数据量：${testResults.dataIds.length}`);
        console.log(`   执行步骤：${testResults.steps.length}`);
        console.log('\n📋 步骤详情:');
        testResults.steps.forEach((step, i) => {
            console.log(`   ${i + 1}. ${step.step}: ${step.status}`);
        });

        // 清理（可选）
        // console.log('\n🗑️  清理测试数据...');
        // await axios.delete(`${API_BASE}/task/${testResults.taskId}`);

    } catch (error) {
        console.error('\n' + '='.repeat(60));
        log('测试失败!', 'error');
        console.error('错误详情:', error.response?.data || error.message);
        console.log('='.repeat(60));

        testResults.steps.push({
            step: error.config?.url?.split('/').pop() || '未知步骤',
            status: 'failed',
            error: error.response?.data || error.message
        });

        process.exit(1);
    }
}

// 运行测试
runTest();
