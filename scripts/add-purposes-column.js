const { Pool } = require('pg');
require('dotenv').config();

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
        console.log('🚀 添加 purposes 字段...');

        await client.query(`
            ALTER TABLE processed_data ADD COLUMN IF NOT EXISTS purposes VARCHAR(64) DEFAULT '';
            CREATE INDEX IF NOT EXISTS idx_pd_purposes ON processed_data(purposes);
            UPDATE processed_data SET purposes = 'rag,finetuning,content_creation' WHERE purposes = '';
        `);

        console.log('✅ 迁移完成！');

        const result = await client.query(`
            SELECT purposes, COUNT(*) FROM processed_data GROUP BY purposes
        `);
        console.log('📊 数据分布:');
        result.rows.forEach(row => {
            console.log(`   ${row.purposes || '(空)'}: ${row.count} 条`);
        });

    } catch (error) {
        console.error('❌ 迁移失败:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
