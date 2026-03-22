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

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('🚀 开始数据库迁移...');
        console.log(`📌 数据库：${process.env.DB_NAME || 'annsight_data'}`);

        // 读取迁移 SQL 文件
        const sqlPath = path.join(__dirname, 'migrations', '001-initial-schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        // 执行迁移
        await client.query(sql);

        console.log('✅ 迁移完成！');
        console.log('📊 已创建的表:');
        console.log('   - users (用户表)');
        console.log('   - raw_data_index (原始数据索引)');
        console.log('   - processed_data (加工数据)');
        console.log('   - review_logs (审核日志)');
        console.log('   - fingerprint_index (指纹库)');

        // 验证表是否存在
        const tables = await client.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        console.log('\n📋 当前数据库表列表:');
        tables.rows.forEach(row => console.log(`   - ${row.table_name}`));

    } catch (error) {
        console.error('❌ 迁移失败:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

async function reset() {
    const client = await pool.connect();

    try {
        console.log('⚠️  开始重置数据库...');

        // 删除所有表
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
