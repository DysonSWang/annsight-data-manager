#!/usr/bin/env node
/**
 * 修复未关联素材的 raw_data_id 关联
 *
 * 问题发现：
 * 1. V9 输出的 source_video 带有"视频标题："前缀
 * 2. raw_data_index 的 video_title 没有这个前缀
 * 3. 导致精确匹配失败
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@172.19.0.3:5432/annsight_data'
});

/**
 * 清理 source_video，移除前缀和后缀
 */
function cleanSourceVideo(sourceVideo) {
    if (!sourceVideo) return null;

    let cleaned = sourceVideo.trim();

    // 移除"视频标题："前缀
    if (cleaned.startsWith('视频标题：')) {
        cleaned = cleaned.substring(5);
    }

    // 移除"来源："前缀
    if (cleaned.startsWith('来源：')) {
        cleaned = cleaned.substring(3);
    }

    return cleaned.trim();
}

/**
 * 提取视频 ID（最后一段数字）
 */
function extractVideoId(title) {
    if (!title) return null;
    const match = title.match(/_(\d+)$/);
    return match ? match[1] : null;
}

/**
 * 主函数
 */
async function main() {
    console.log('========================================');
    console.log('修复未关联素材的 raw_data_id 关联');
    console.log('========================================\n');

    // 1. 获取所有未关联的素材（raw_data_id IS NULL）
    const unlinkedMaterials = await pool.query(`
        SELECT id, source_video, material_type
        FROM processed_data
        WHERE raw_data_id IS NULL
        AND source_video IS NOT NULL
        AND source_video != ''
        ORDER BY id
    `);

    console.log('未关联素材总数:', unlinkedMaterials.rows.length);

    let successCount = 0;
    let failedCount = 0;
    let noMatchCount = 0;

    // 2. 加载所有 raw_data_index 的 video_title 映射
    const rawDataMap = new Map();
    const rawDataResult = await pool.query(`
        SELECT id, metadata->>'video_title' as video_title
        FROM raw_data_index
        WHERE metadata->>'video_title' IS NOT NULL
    `);

    rawDataResult.rows.forEach(row => {
        const title = row.video_title;
        const id = row.id;

        // 精确匹配
        rawDataMap.set(title, id);

        // 视频 ID 匹配
        const videoId = extractVideoId(title);
        if (videoId) {
            rawDataMap.set('id_' + videoId, id);
        }
    });

    console.log('加载了', rawDataMap.size, '个 raw_data_index 映射\n');

    // 3. 逐个尝试匹配
    const updateStatements = [];

    for (const material of unlinkedMaterials.rows) {
        const sourceVideo = material.source_video;
        const cleanedVideo = cleanSourceVideo(sourceVideo);
        const videoId = extractVideoId(cleanedVideo);

        let matchedId = null;
        let matchType = null;

        // 精确匹配（清理后）
        if (rawDataMap.has(cleanedVideo)) {
            matchedId = rawDataMap.get(cleanedVideo);
            matchType = '精确匹配';
        }

        // 视频 ID 匹配
        if (!matchedId && videoId && rawDataMap.has('id_' + videoId)) {
            matchedId = rawDataMap.get('id_' + videoId);
            matchType = '视频 ID 匹配';
        }

        if (matchedId) {
            updateStatements.push({
                materialId: material.id,
                rawDataId: matchedId,
                sourceVideo: sourceVideo,
                matchType: matchType
            });
            successCount++;
        } else {
            noMatchCount++;
        }

        if ((successCount + noMatchCount) % 100 === 0) {
            console.log('已处理:', successCount + noMatchCount, '成功:', successCount, '无匹配:', noMatchCount);
        }
    }

    // 4. 批量更新
    console.log('\n=== 匹配结果 ===');
    console.log('成功匹配:', successCount);
    console.log('无匹配:', noMatchCount);

    if (updateStatements.length > 0) {
        console.log('\n开始批量更新...\n');

        let updated = 0;
        for (const stmt of updateStatements) {
            try {
                await pool.query(`
                    UPDATE processed_data
                    SET raw_data_id = $1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `, [stmt.rawDataId, stmt.materialId]);
                updated++;

                if (updated % 100 === 0) {
                    console.log('已更新:', updated, '条');
                }
            } catch (err) {
                console.error('更新失败:', stmt.materialId, err.message);
                failedCount++;
            }
        }

        console.log('\n更新完成:', updated, '条成功,', failedCount, '条失败');

        // 显示匹配示例
        console.log('\n=== 匹配示例（前 20 条）===');
        updateStatements.slice(0, 20).forEach(stmt => {
            console.log(stmt.matchType + ': ' + stmt.sourceVideo.substring(0, 50) + ' → ' + stmt.rawDataId);
        });
    }

    // 5. 验证结果
    const finalCount = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE raw_data_id IS NOT NULL) as linked,
            COUNT(*) FILTER (WHERE raw_data_id IS NULL) as unlinked
        FROM processed_data
    `);

    console.log('\n=== 最终统计 ===');
    console.log('已关联素材:', finalCount.rows[0].linked);
    console.log('未关联素材:', finalCount.rows[0].unlinked);
    console.log('关联率:', ((parseInt(finalCount.rows[0].linked) / (parseInt(finalCount.rows[0].linked) + parseInt(finalCount.rows[0].unlinked))) * 100).toFixed(2) + '%');

    await pool.end();
    console.log('\n✓ 完成');
}

main().catch(err => {
    console.error('错误:', err);
    pool.end();
    process.exit(1);
});
