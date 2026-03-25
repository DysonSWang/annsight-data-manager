const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annsight_data'
});

async function runMigration() {
    const sqlPath = path.join(__dirname, '003-logical-coherence-refactor.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('开始执行数据库迁移...');
    console.log('迁移文件：003-logical-coherence-refactor.sql');
    console.log('---');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 执行迁移 SQL
        await client.query(sql);

        await client.query('COMMIT');
        console.log('---');
        console.log('迁移成功完成！');

        // 验证新字段
        console.log('\n验证新字段...');

        const processedDataColumns = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'processed_data'
            AND column_name IN ('source_data_id', 'source_task_id', 'task_context', 'fission_config')
            ORDER BY column_name
        `);

        console.log('processed_data 新字段:');
        processedDataColumns.rows.forEach(row => {
            console.log('  - ' + row.column_name + ': ' + row.data_type);
        });

        const finetuningTasksColumns = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'finetuning_tasks'
            AND column_name IN ('fission_enabled', 'fission_count', 'fission_requirement')
            ORDER BY column_name
        `);

        console.log('finetuning_tasks 新字段:');
        finetuningTasksColumns.rows.forEach(row => {
            console.log('  - ' + row.column_name + ': ' + row.data_type);
        });

        console.log('\n所有迁移完成！');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('迁移失败:', error.message);
        console.error(error.stack);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration()
    .then(() => {
        console.log('退出码 0');
        process.exit(0);
    })
    .catch((err) => {
        console.error('未捕获的错误:', err.message);
        process.exit(1);
    });
