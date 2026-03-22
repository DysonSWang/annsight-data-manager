#!/usr/bin/env node
const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function check() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT id, type, category, ai_confidence_score, review_status FROM processed_data');
        console.log(`Found ${result.rows.length} records in processed_data`);
        result.rows.forEach(row => console.log(JSON.stringify(row, null, 2)));
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

check();
