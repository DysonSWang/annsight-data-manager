#!/usr/bin/env node
/**
 * 运行数据库迁移 006 - 源数据审核流程优化
 * 用法：node scripts/migrations/run-migration-006.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
});

async function runMigration() {
    const sqlPath = path.join(__dirname, '006-raw-data-review.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    const client = await pool.connect();

    try {
        console.log('开始运行迁移 006 - 源数据审核流程优化...');

        // 检查是否已经运行过
        const checkResult = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_enabled'
            ) as migrated
        `);

        if (checkResult.rows[0].migrated) {
            console.log('⚠️  迁移已经运行过，跳过');
            return;
        }

        // 运行迁移 SQL - 直接执行整个 SQL 文件
        // DO $$ ... $$ 块需要作为一个整体执行，不能用分号分割
        await client.query(sql);

        await client.query('COMMIT');

        console.log('✅ 迁移 006 完成！');
        console.log('   - raw_data_index 表新增审核字段');
        console.log('   - 创建 raw_data_review_rounds 表');
        console.log('   - 创建 raw_data_review_feedback_logs 表');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 迁移失败:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
