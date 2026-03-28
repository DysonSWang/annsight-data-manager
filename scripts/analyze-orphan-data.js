#!/usr/bin/env node
/**
 * 分析源数据与素材的关联关系
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@172.19.0.3:5432/annsight_data'
});

(async () => {
    console.log('=== 源数据与素材关联分析 ===\n');

    // 1. 源数据总数
    const rawDataCount = await pool.query('SELECT COUNT(*) FROM raw_data_index');
    console.log('1. 源数据总数:', rawDataCount.rows[0].count);

    // 2. 有素材的源数据数量
    const rawDataWithMaterials = await pool.query(`
        SELECT COUNT(DISTINCT rdi.id)
        FROM raw_data_index rdi
        INNER JOIN processed_data pd ON rdi.id = pd.raw_data_id
    `);
    console.log('2. 有素材的源数据:', rawDataWithMaterials.rows[0].count);

    // 3. 没有素材的源数据数量
    const rawDataWithoutMaterials = await pool.query(`
        SELECT COUNT(*)
        FROM raw_data_index rdi
        WHERE NOT EXISTS (
            SELECT 1 FROM processed_data pd WHERE pd.raw_data_id = rdi.id
        )
    `);
    console.log('3. 没有素材的源数据:', rawDataWithoutMaterials.rows[0].count);

    // 4. 素材总数
    const materialsCount = await pool.query('SELECT COUNT(*) FROM processed_data');
    console.log('4. 素材总数:', materialsCount.rows[0].count);

    // 5. 已关联源数据的素材数量
    const materialsWithRawData = await pool.query(`
        SELECT COUNT(*)
        FROM processed_data pd
        WHERE pd.raw_data_id IS NOT NULL
    `);
    console.log('5. 已关联源数据的素材:', materialsWithRawData.rows[0].count);

    // 6. 未关联源数据的素材数量 (raw_data_id IS NULL)
    const materialsWithoutRawData = await pool.query(`
        SELECT COUNT(*)
        FROM processed_data pd
        WHERE pd.raw_data_id IS NULL
    `);
    console.log('6. 未关联源数据的素材 (NULL):', materialsWithoutRawData.rows[0].count);

    // 7. 源数据 ID 不存在的孤立素材
    const orphanMaterials = await pool.query(`
        SELECT COUNT(*)
        FROM processed_data pd
        WHERE pd.raw_data_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM raw_data_index rdi WHERE rdi.id = pd.raw_data_id
        )
    `);
    console.log('7. 源数据不存在的孤立素材:', orphanMaterials.rows[0].count);

    // 8. 没有素材的源数据示例
    const orphanRawDataSamples = await pool.query(`
        SELECT rdi.id, rdi.metadata->>'video_title' as video_title, rdi.created_at
        FROM raw_data_index rdi
        WHERE NOT EXISTS (
            SELECT 1 FROM processed_data pd WHERE pd.raw_data_id = rdi.id
        )
        ORDER BY rdi.created_at DESC
        LIMIT 10
    `);
    console.log('\n8. 没有素材的源数据示例 (前 10 条):');
    orphanRawDataSamples.rows.forEach(row => {
        const title = row.video_title || '无标题';
        console.log('   - ' + row.id + ': ' + title.substring(0, 60) + (title.length > 60 ? '...' : ''));
    });

    // 9. 未关联素材的 source_video 分析
    const unlinkedSourceVideos = await pool.query(`
        SELECT source_video, COUNT(*) as count
        FROM processed_data
        WHERE raw_data_id IS NULL
        AND source_video IS NOT NULL
        AND source_video != ''
        GROUP BY source_video
        ORDER BY count DESC
        LIMIT 10
    `);
    console.log('\n9. 未关联素材的 source_video TOP 10:');
    unlinkedSourceVideos.rows.forEach(row => {
        console.log('   - ' + row.source_video + ': ' + row.count + '条');
    });

    // 10. 未关联素材按类型统计
    const unlinkedByType = await pool.query(`
        SELECT material_type, COUNT(*) as count
        FROM processed_data
        WHERE raw_data_id IS NULL
        GROUP BY material_type
        ORDER BY count DESC
    `);
    console.log('\n10. 未关联素材按类型统计:');
    unlinkedByType.rows.forEach(row => {
        console.log('    - ' + (row.material_type || 'NULL') + ': ' + row.count + '条');
    });

    // 11. 关联率统计
    const rawDataTotal = parseInt(rawDataCount.rows[0].count);
    const rawDataWithMat = parseInt(rawDataWithMaterials.rows[0].count);
    const materialsTotal = parseInt(materialsCount.rows[0].count);
    const materialsWithRaw = parseInt(materialsWithRawData.rows[0].count);

    console.log('\n=== 关联率统计 ===');
    console.log('源数据关联率:', ((rawDataWithMat / rawDataTotal) * 100).toFixed(2) + '% (' + rawDataWithMat + '/' + rawDataTotal + ')');
    console.log('素材关联率:', ((materialsWithRaw / materialsTotal) * 100).toFixed(2) + '% (' + materialsWithRaw + '/' + materialsTotal + ')');

    await pool.end();
})();
