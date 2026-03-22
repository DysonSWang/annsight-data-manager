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
    const result = await pool.query('SELECT id, source, batch_id, status, content_md5, created_at FROM raw_data_index ORDER BY created_at DESC LIMIT 10');
    console.log(`Found ${result.rows.length} records in raw_data_index`);
    result.rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
    await pool.end();
}

check();
