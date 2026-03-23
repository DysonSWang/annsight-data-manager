#!/usr/bin/env node
/**
 * 数据库迁移脚本
 * 用法：node scripts/migrate.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function runMigration(sqlFile, description) {
    const client = await pool.connect();
    try {
        const sqlPath = path.join(__dirname, 'migrations', sqlFile);
        if (!fs.existsSync(sqlPath)) {
            console.log(`⏭️  跳过迁移：${sqlFile} (文件不存在)`);
            return false;
        }

        const sql = fs.readFileSync(sqlPath, 'utf-8');
        await client.query(sql);
        console.log(`✅ ${description}`);
        return true;
    } catch (error) {
        console.error(`❌ ${description} 失败:`, error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function migrate() {
    try {
        console.log('🚀 开始数据库迁移...');
        console.log(`📌 数据库：${process.env.DB_NAME || 'annsight_data'}`);

        // 按顺序执行迁移文件
        await runMigration('001-initial-schema.sql', '初始表结构创建完成');
        await runMigration('002-finetuning-task.sql', '微调任务表结构创建完成');

        console.log('\n✅ 所有迁移已完成！');

        // 验证表是否存在
        const client = await pool.connect();
        const tables = await client.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        client.release();

        console.log('\n📊 已创建的表:');
        tables.rows.forEach(row => console.log(`   - ${row.table_name}`));

    } catch (error) {
        console.error('\n❌ 迁移失败:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

async function reset() {
    const client = await pool.connect();

    try {
        console.log('⚠️  开始重置数据库...');

        // 删除所有表（包括新表）
        await client.query('DROP TABLE IF EXISTS review_rounds CASCADE');
        await client.query('DROP TABLE IF EXISTS finetuning_tasks CASCADE');
        await client.query('DROP TABLE IF EXISTS review_logs CASCADE');
        await client.query('DROP TABLE IF EXISTS fingerprint_index CASCADE');
        await client.query('DROP TABLE IF EXISTS processed_data CASCADE');
        await client.query('DROP TABLE IF EXISTS raw_data_index CASCADE');
        await client.query('DROP TABLE IF EXISTS users CASCADE');

        console.log('✅ 数据库已重置');

        // 重新运行迁移
        await migrate();

    } catch (error) {
        console.error('❌ 重置失败:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// 主程序
const args = process.argv.slice(2);
if (args.includes('--reset')) {
    reset();
} else {
    migrate();
}
