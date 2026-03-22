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
    const result = await pool.query(`
        SELECT id, ai_confidence_score, ai_model_version, type, category, review_status
        FROM processed_data
        LIMIT 5
    `);
    console.log('Database records:');
    result.rows.forEach(r => console.log(JSON.stringify(r)));
    await pool.end();
}

check();
