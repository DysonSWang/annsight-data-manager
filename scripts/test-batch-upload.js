#!/usr/bin/env node
const { Pool } = require('pg');
const { EtlService } = require('../src/pipeline/etl-service');
const RawDataIndexRepository = require('../src/repository/RawDataIndexRepository');
require('dotenv').config({ path: __dirname + '/../.env' });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function test() {
    const text = '测试文本：职场沟通中，倾听比说话更重要。';
    const source = 'test';
    const batchId = 'batch-test-manual';

    try {
        const repo = new RawDataIndexRepository(pool);
        const id = `rd-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        const md5 = require('crypto').createHash('md5').update(text).digest('hex');

        console.log('Creating raw data record...');
        const rawData = await repo.create({
            id,
            ossUrl: '',
            contentType: 'text/plain',
            source,
            batchId,
            contentMd5: md5,
            metadata: { text }
        });
        console.log('Raw data created:', rawData.id);

        console.log('Processing text via ETL...');
        const etlService = new EtlService(pool);
        const result = await etlService.processText(text, { source, batchId });
        console.log('ETL result:', result);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

test();
