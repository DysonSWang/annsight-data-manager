#!/usr/bin/env node
/**
 * 测试 ETL pipeline 输出字段
 */
const { EtlService } = require('../src/pipeline/etl-service');
const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function test() {
    const etlService = new EtlService(pool);

    // 使用新的处理器实例（不缓存）
    etlService._processorsCache = null;

    const result = await etlService.processText('职场沟通中，学会倾听非常重要。');

    console.log('Pipeline result context:');
    console.log('aiConfidenceScore:', result.context.aiConfidenceScore);
    console.log('aiModelVersion:', result.context.aiModelVersion);
    console.log('type:', result.context.type);
    console.log('category:', result.context.category);

    await pool.end();
}

test();
