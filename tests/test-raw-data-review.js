#!/usr/bin/env node
/**
 * 测试源数据审核功能
 * 用法：node tests/test-raw-data-review.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

const API_BASE = 'http://localhost:3000/api/raw-data';

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
});

async function testRawDataReview() {
    console.log('=== 源数据审核功能测试 ===\n');

    try {
        // 1. 获取数据列表
        console.log('1. 获取源数据列表...');
        const listRes = await axios.get(`${API_BASE}/list?pageSize=5`);
        const dataList = listRes.data.data;
        console.log(`   找到 ${dataList.length} 条数据`);

        if (dataList.length === 0) {
            console.log('   没有数据可测试');
            return;
        }

        const testData = dataList[0];
        console.log(`   测试数据 ID: ${testData.id}`);

        // 2. 获取数据详情
        console.log('\n2. 获取数据详情...');
        const detailRes = await axios.get(`${API_BASE}/${testData.id}`);
        console.log(`   数据来源：${detailRes.data.data.source}`);
        console.log(`   数据状态：${detailRes.data.data.status}`);

        // 3. 获取审核轮次
        console.log('\n3. 获取审核轮次记录...');
        const roundsRes = await axios.get(`${API_BASE}/${testData.id}/review-rounds`);
        console.log(`   审核轮次数：${roundsRes.data.count}`);

        // 4. 获取反馈日志
        console.log('\n4. 获取反馈日志...');
        const batchId = testData.batch_id;
        const feedbackRes = await axios.get(`${API_BASE}/${batchId}/feedback-logs`);
        console.log(`   反馈日志数：${feedbackRes.data.count}`);

        // 5. 测试 AI 审核（如果有 pending 数据）
        console.log('\n5. 测试 AI 审核接口...');
        try {
            const aiReviewRes = await axios.post(`${API_BASE}/${batchId}/ai-review/start`, {
                aiReviewConfig: {
                    enabled: true,
                    maxRounds: 1,
                    passThreshold: 0.75,
                    autoOptimize: false,
                    prompt: '测试审核要求：内容需要完整、准确、有价值'
                }
            });
            console.log(`   AI 审核结果：${aiReviewRes.data.success ? '成功' : '失败'}`);
            if (aiReviewRes.data.summary) {
                console.log(`   审核摘要：通过 ${aiReviewRes.data.summary.approved}/${aiReviewRes.data.summary.total}`);
            }
        } catch (error) {
            console.log(`   AI 审核接口测试：${error.response?.status === 500 ? '服务器错误（可能是 API 未配置）' : error.message}`);
        }

        // 6. 测试人工审核列表
        console.log('\n6. 测试人工审核列表接口...');
        try {
            const manualListRes = await axios.get(`${API_BASE}/${batchId}/manual-review/list?scope=failed`);
            console.log(`   待人工审核数据：${manualListRes.data.count} 条`);
        } catch (error) {
            console.log(`   人工审核列表接口测试：${error.message}`);
        }

        console.log('\n=== 测试完成 ===');

    } catch (error) {
        console.error('测试失败:', error.message);
        if (error.response) {
            console.error('响应状态:', error.response.status);
            console.error('响应数据:', JSON.stringify(error.response.data).slice(0, 200));
        }
    } finally {
        await pool.end();
    }
}

testRawDataReview();
