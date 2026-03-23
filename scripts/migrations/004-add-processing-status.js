const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'annsight_data',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
});

async function runMigration() {
    const client = await pool.connect();

    try {
        console.log('Running migration: Add processing_status column...');

        await client.query(`
            ALTER TABLE raw_data_index
            ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT NULL
        `);

        console.log('✅ Added processing_status column');

        // 创建索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_raw_data_processing_status
            ON raw_data_index(processing_status)
        `);

        console.log('✅ Created index on processing_status');

        // 验证
        const result = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'raw_data_index' AND column_name = 'processing_status'
        `);

        console.log('✅ Migration completed successfully!');
        console.log('Column info:', result.rows);

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration().catch(console.error);
