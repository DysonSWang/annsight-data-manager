#!/usr/bin/env node
/**
 * 清理低质量未关联素材
 *
 * 删除条件：
 * 1. source_video = '视频标题' (占位符)
 * 2. source_video IS NULL (数据缺失)
 * 3. source_video = '鹅鸭杀有多好玩' (无对应源数据)
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@172.19.0.3:5432/annsight_data'
});

(async () => {
    console.log('========================================');
    console.log('清理低质量未关联素材');
    console.log('========================================\n');

    // 1. 删除前统计
    const beforeStats = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE raw_data_id IS NOT NULL) as linked,
            COUNT(*) FILTER (WHERE raw_data_id IS NULL) as unlinked,
            COUNT(*) as total
        FROM processed_data
    `);

    console.log('清理前:');
    console.log('  总素材数:', beforeStats.rows[0].total);
    console.log('  已关联:', beforeStats.rows[0].linked);
    console.log('  未关联:', beforeStats.rows[0].unlinked);

    // 2. 显示将要删除的素材
    const toDelete = await pool.query(`
        SELECT id, material_type, source_video, title
        FROM processed_data
        WHERE raw_data_id IS NULL
        AND (
            source_video = '视频标题'
            OR source_video IS NULL
            OR source_video = '鹅鸭杀有多好玩'
        )
        ORDER BY id
    `);

    console.log('\n将要删除的素材 (' + toDelete.rows.length + '条):');
    console.log('---');
    toDelete.rows.forEach(row => {
        const sv = row.source_video || 'NULL';
        const t = row.title ? row.title.substring(0, 40) : '无标题';
        console.log('[' + row.material_type + '] source: ' + sv + ' | title: ' + t);
    });

    if (toDelete.rows.length === 0) {
        console.log('\n没有需要删除的素材');
        await pool.end();
        return;
    }

    // 3. 执行删除
    console.log('\n开始删除...\n');

    const result = await pool.query(`
        DELETE FROM processed_data
        WHERE raw_data_id IS NULL
        AND (
            source_video = '视频标题'
            OR source_video IS NULL
            OR source_video = '鹅鸭杀有多好玩'
        )
        RETURNING id
    `);

    console.log('已删除:', result.rows.length, '条素材');

    // 4. 删除后统计
    const afterStats = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE raw_data_id IS NOT NULL) as linked,
            COUNT(*) FILTER (WHERE raw_data_id IS NULL) as unlinked,
            COUNT(*) as total
        FROM processed_data
    `);

    console.log('\n清理后:');
    console.log('  总素材数:', afterStats.rows[0].total);
    console.log('  已关联:', afterStats.rows[0].linked);
    console.log('  未关联:', afterStats.rows[0].unlinked);

    // 5. 计算关联率
    const beforeRate = ((parseInt(beforeStats.rows[0].linked) / parseInt(beforeStats.rows[0].total)) * 100).toFixed(2);
    const afterRate = ((parseInt(afterStats.rows[0].linked) / parseInt(afterStats.rows[0].total)) * 100).toFixed(2);

    console.log('\n关联率变化:', beforeRate + '% → ' + afterRate + '%');

    // 6. 验证无源数据的源数据
    const orphanRawData = await pool.query(`
        SELECT COUNT(*) as count
        FROM raw_data_index rdi
        WHERE NOT EXISTS (
            SELECT 1 FROM processed_data pd WHERE pd.raw_data_id = rdi.id
        )
    `);

    console.log('\n无素材的源数据:', orphanRawData.rows[0].count, '条（这些是正常的跳过内容）');

    await pool.end();
    console.log('\n✓ 完成');
})();
