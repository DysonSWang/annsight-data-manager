const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annsight_data'
});

async function runMigration() {
    const sqlPath = path.join(__dirname, '005-review-workflow-optimization.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('开始执行数据库迁移...');
    console.log('迁移文件：005-review-workflow-optimization.sql');
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

        const finetuningTasksColumns = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'finetuning_tasks'
            AND column_name IN (
                'ai_review_enabled', 'ai_review_max_rounds', 'ai_review_pass_threshold',
                'ai_auto_optimize_enabled', 'manual_review_enabled', 'manual_review_scope',
                'manual_review_optimization_enabled'
            )
            ORDER BY column_name
        `);

        console.log('finetuning_tasks 新字段:');
        finetuningTasksColumns.rows.forEach(row => {
            console.log('  - ' + row.column_name + ': ' + row.data_type);
        });

        const reviewRoundsColumns = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'review_rounds'
            AND column_name IN ('manual_optimization_prompt')
            ORDER BY column_name
        `);

        console.log('review_rounds 新字段:');
        reviewRoundsColumns.rows.forEach(row => {
            console.log('  - ' + row.column_name + ': ' + row.data_type);
        });

        const feedbackLogsExists = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = 'review_feedback_logs'
        `);

        if (feedbackLogsExists.rows.length > 0) {
            console.log('\nreview_feedback_logs 表：已创建 ✓');

            const feedbackLogsColumns = await client.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'review_feedback_logs'
                ORDER BY ordinal_position
            `);

            console.log('字段列表:');
            feedbackLogsColumns.rows.forEach(row => {
                console.log('  - ' + row.column_name + ': ' + row.data_type);
            });
        }

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
