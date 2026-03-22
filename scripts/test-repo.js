#!/usr/bin/env node
/**
 * 测试 Repository.create() 方法
 */
const { Pool } = require('pg');
const ProcessedDataRepository = require('../src/repository/ProcessedDataRepository');
require('dotenv').config({ path: __dirname + '/../.env' });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function test() {
    const repo = new ProcessedDataRepository(pool);

    const result = await repo.create({
        id: `pd-test-${Date.now()}`,
        rawDataId: null,
        type: '测试类型',
        category: '测试分类',
        title: '测试标题',
        content: '测试内容',
        aiConfidenceScore: 0.85,
        aiModelVersion: 'test-v1.0'
    });

    console.log('Created record:');
    console.log('id:', result.id);
    console.log('ai_confidence_score:', result.ai_confidence_score);
    console.log('ai_model_version:', result.ai_model_version);

    await pool.end();
}

test();
