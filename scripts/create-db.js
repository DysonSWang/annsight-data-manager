#!/usr/bin/env node
/**
 * 创建数据库脚本
 */

const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

// 连接到 default 数据库 (postgres)
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: 'postgres',  // 连接到默认数据库
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function createDatabase() {
    const client = await pool.connect();
    const dbName = process.env.DB_NAME || 'annsight_data';

    try {
        // 检查数据库是否已存在
        const check = await client.query(`
            SELECT 1 FROM pg_database WHERE datname = $1
        `, [dbName]);

        if (check.rows.length > 0) {
            console.log(`✅ 数据库 '${dbName}' 已存在`);
            return;
        }

        // 创建数据库
        await client.query(`CREATE DATABASE ${dbName}`);
        console.log(`✅ 数据库 '${dbName}' 创建成功`);

    } catch (error) {
        console.error('❌ 创建数据库失败:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

createDatabase();
