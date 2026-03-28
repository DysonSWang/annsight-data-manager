#!/usr/bin/env node
/**
 * 导入 V9 处理后的素材到 processed_data 表
 * 增强版：使用集数 + 主标题模糊匹配
 *
 * 用法：node scripts/import-v9-materials-v2.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const V9_DIR = process.env.V9_DIR || '/home/admin/projects/eq-trainning/t2';
const DATABASE_URL = process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@172.19.0.3:5432/${process.env.DB_NAME || 'annsight_data'}`;

const BATCH_FILES = {
    sft: 'sft_data.jsonl',
    rag: 'rag_knowledge.jsonl',
    dpo: 'dpo_data.jsonl',
    story: 'story_materials.jsonl',
    content: 'content_materials.jsonl'
};

const pool = new Pool({ connectionString: DATABASE_URL });

/**
 * 读取 JSONL 文件
 */
function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`文件不存在：${filePath}`);
        return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.trim().split('\n').filter(line => line.trim()).map(line => {
        try {
            return JSON.parse(line);
        } catch (e) {
            console.warn(`JSON 解析失败：${line.substring(0, 100)}...`);
            return null;
        }
    }).filter(item => item !== null);
}

/**
 * 从完整标题中提取短标题（去掉 hashtags 和视频 ID）
 */
function extractShortTitle(fullTitle) {
    if (!fullTitle) return null;

    // 查找第一个 "#" 或 " #" 的位置，这是 hashtags 的开始
    const hashIndex = fullTitle.indexOf('#');
    if (hashIndex > 0) {
        return fullTitle.substring(0, hashIndex).trim();
    }

    // 如果没有 hashtags，可能标题末尾有视频 ID（如下划线分隔）
    const underscoreIndex = fullTitle.lastIndexOf('_');
    if (underscoreIndex > 0 && underscoreIndex > fullTitle.length - 15) {
        return fullTitle.substring(0, underscoreIndex).trim();
    }

    return fullTitle.trim();
}

/**
 * 从标题中提取集数（如"第 12 集"→ 12）
 */
function extractEpisodeNum(title) {
    if (!title) return null;
    const match = title.match(/第\s*(\d+)\s*集/);
    if (match) {
        return parseInt(match[1]);
    }
    return null;
}

/**
 * 从标题中提取主标题（"第 X 集 _ "之后的部分，去掉 hashtags）
 */
function extractMainTitle(title) {
    if (!title) return null;

    // 先去掉 hashtags
    const shortTitle = extractShortTitle(title);
    if (!shortTitle) return null;

    // 提取"第 X 集 _ "之后的部分
    const match = shortTitle.match(/第\d+ 集\s*_\s*(.+)/);
    if (match) {
        return match[1].trim();
    }

    return shortTitle;
}

/**
 * 加载视频映射（支持多种匹配方式）
 */
async function loadVideoToRawDataMap() {
    const result = await pool.query(`
        SELECT id, metadata->>'video_title' as video_title
        FROM raw_data_index
        WHERE metadata->>'video_title' IS NOT NULL
    `);

    const map = {
        byFullTitle: new Map(),      // 完整标题 → raw_data_id
        byShortTitle: new Map(),     // 短标题 → raw_data_id
        byEpisode: new Map(),        // 集数 → [raw_data_id]
        byMainTitle: new Map(),      // 主标题 → raw_data_id
    };

    for (const row of result.rows) {
        const title = row.video_title;
        const id = row.id;

        if (!title) continue;

        // 1. 完整标题映射
        map.byFullTitle.set(title, id);

        // 2. 短标题映射
        const shortTitle = extractShortTitle(title);
        if (shortTitle && shortTitle !== title) {
            map.byShortTitle.set(shortTitle, id);
        }

        // 3. 集数映射（一个集数可能有多个视频）
        const episodeNum = extractEpisodeNum(title);
        if (episodeNum) {
            if (!map.byEpisode.has(episodeNum)) {
                map.byEpisode.set(episodeNum, []);
            }
            map.byEpisode.get(episodeNum).push({ id, title, shortTitle });
        }

        // 4. 主标题映射
        const mainTitle = extractMainTitle(title);
        if (mainTitle) {
            map.byMainTitle.set(mainTitle, id);
        }
    }

    console.log(`加载了 ${map.byFullTitle.size} 个完整标题映射`);
    console.log(`加载了 ${map.byShortTitle.size} 个短标题映射`);
    console.log(`加载了 ${map.byEpisode.size} 个集数映射`);
    console.log(`加载了 ${map.byMainTitle.size} 个主标题映射`);

    return map;
}

/**
 * 查找 raw_data_id（支持多种匹配方式）
 */
function findRawDataId(sourceVideo, videoMap) {
    if (!sourceVideo) return null;

    // 1. 精确匹配完整标题
    if (videoMap.byFullTitle.has(sourceVideo)) {
        return videoMap.byFullTitle.get(sourceVideo);
    }

    // 2. 精确匹配短标题
    if (videoMap.byShortTitle.has(sourceVideo)) {
        return videoMap.byShortTitle.get(sourceVideo);
    }

    // 3. 按集数匹配（取第一个）
    const episodeNum = extractEpisodeNum(sourceVideo);
    if (episodeNum && videoMap.byEpisode.has(episodeNum)) {
        const candidates = videoMap.byEpisode.get(episodeNum);

        // 尝试匹配短标题
        const shortSource = extractShortTitle(sourceVideo);
        const matched = candidates.find(c => {
            return c.shortTitle === shortSource ||
                   (c.shortTitle && c.shortTitle.includes(shortSource?.substring(0, 20) || ''));
        });

        if (matched) {
            return matched.id;
        }

        // 返回该集数的第一个视频
        return candidates[0].id;
    }

    // 4. 按主标题匹配
    const sourceMainTitle = extractMainTitle(sourceVideo);
    if (sourceMainTitle && videoMap.byMainTitle.has(sourceMainTitle)) {
        return videoMap.byMainTitle.get(sourceMainTitle);
    }

    return null;
}

/**
 * 从 item 中提取 source_video（支持多层嵌套）
 */
function extractSourceVideo(item) {
    if (item.source_video) return item.source_video;
    if (item.metadata?.source_video) return item.metadata.source_video;
    if (item.messages && item.metadata?.source_video) return item.metadata.source_video;
    if (item.source) return item.source;
    return '';
}

/**
 * 转换 SFT 数据格式
 */
function convertSft(item, index, pipeline) {
    const sourceVideo = extractSourceVideo(item);
    return {
        id: `v9_${pipeline}_${index}`,
        raw_data_id: null,
        material_type: 'sft',
        content_type: 'finetuning',
        source_video: sourceVideo,
        source_timestamp: item.source_timestamp || '',
        quality_score: item.quality_score || 0.8,
        type: item.type || 'standard',
        category: item.category || 'general',
        title: item.title || '',
        content: JSON.stringify(item.messages || item),
        tags: JSON.stringify(item.tags || []),
        conversation: null,
        purposes: 'finetuning'
    };
}

/**
 * 转换 RAG 数据格式
 */
function convertRag(item, index, pipeline) {
    const sourceVideo = extractSourceVideo(item);
    return {
        id: `v9_${pipeline}_${index}`,
        raw_data_id: null,
        material_type: 'rag',
        content_type: 'knowledge',
        source_video: sourceVideo,
        source_timestamp: item.source_timestamp || '',
        quality_score: item.quality_score || 0.8,
        type: item.type || 'qa',
        category: item.category || 'general',
        title: item.name || item.title || '',
        content: item.content || '',
        tags: JSON.stringify(item.tags || []),
        conversation: null,
        purposes: 'rag'
    };
}

/**
 * 转换 DPO 数据格式
 */
function convertDpo(item, index, pipeline) {
    const sourceVideo = extractSourceVideo(item);
    return {
        id: `v9_${pipeline}_${index}`,
        raw_data_id: null,
        material_type: 'dpo',
        content_type: 'preference',
        source_video: sourceVideo,
        source_timestamp: '',
        quality_score: 0.8,
        type: 'comparison',
        category: 'general',
        title: `DPO-${index}`,
        content: JSON.stringify(item),
        tags: JSON.stringify([]),
        conversation: null,
        purposes: 'finetuning'
    };
}

/**
 * 转换故事素材格式
 */
function convertStory(item, index, pipeline) {
    const sourceVideo = extractSourceVideo(item);
    return {
        id: `v9_${pipeline}_${index}`,
        raw_data_id: null,
        material_type: 'story',
        content_type: 'story',
        source_video: sourceVideo,
        source_timestamp: item.source_timestamp || '',
        quality_score: item.quality_score || 0.8,
        type: 'story',
        category: item.category || 'general',
        title: item.title || '',
        content: item.content || JSON.stringify(item),
        tags: JSON.stringify(item.tags || []),
        conversation: null,
        purposes: 'content_creation'
    };
}

/**
 * 转换内容素材格式
 */
function convertContent(item, index, pipeline) {
    const sourceVideo = extractSourceVideo(item);
    return {
        id: `v9_${pipeline}_${index}`,
        raw_data_id: null,
        material_type: 'content',
        content_type: 'content',
        source_video: sourceVideo,
        source_timestamp: item.source_timestamp || '',
        quality_score: item.quality_score || 0.8,
        type: item.type || item.category || 'general',
        category: item.category || 'general',
        title: item.title || '',
        content: item.content || '',
        tags: JSON.stringify(item.tags || []),
        conversation: null,
        purposes: 'content_creation'
    };
}

/**
 * 导入素材
 */
async function importMaterials(pipeline, videoMap) {
    const filePath = path.join(V9_DIR, BATCH_FILES[pipeline]);
    const data = readJsonl(filePath);

    if (data.length === 0) {
        console.log(`  ${pipeline}: 无数据`);
        return 0;
    }

    const convertFn = {
        sft: convertSft,
        rag: convertRag,
        dpo: convertDpo,
        story: convertStory,
        content: convertContent
    }[pipeline];

    let success = 0;
    let failed = 0;
    let linked = 0;

    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        const material = convertFn(item, i, pipeline);

        // 查找 raw_data_id
        material.raw_data_id = findRawDataId(material.source_video, videoMap);
        if (material.raw_data_id) {
            linked++;
        }

        try {
            const query = `
                INSERT INTO processed_data
                (id, raw_data_id, material_type, content_type, source_video, source_timestamp,
                 quality_score, type, category, title, content, tags, conversation, purposes, review_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending')
                ON CONFLICT (id) DO UPDATE SET
                    raw_data_id = EXCLUDED.raw_data_id,
                    material_type = EXCLUDED.material_type,
                    content_type = EXCLUDED.content_type,
                    source_video = EXCLUDED.source_video,
                    source_timestamp = EXCLUDED.source_timestamp,
                    quality_score = EXCLUDED.quality_score,
                    type = EXCLUDED.type,
                    category = EXCLUDED.category,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    tags = EXCLUDED.tags,
                    conversation = EXCLUDED.conversation,
                    purposes = EXCLUDED.purposes,
                    review_status = EXCLUDED.review_status,
                    updated_at = CURRENT_TIMESTAMP
            `;

            const params = [
                material.id,
                material.raw_data_id,
                material.material_type,
                material.content_type,
                material.source_video,
                material.source_timestamp,
                material.quality_score,
                material.type,
                material.category,
                material.title,
                material.content,
                material.tags,
                material.conversation,
                material.purposes
            ];

            await pool.query(query, params);
            success++;

            if (success % 500 === 0) {
                console.log(`  ${pipeline}: 已导入 ${success} 条 (关联 ${linked} 条)...`);
            }
        } catch (err) {
            console.warn(`导入失败 ${material.id}: ${err.message}`);
            failed++;
        }
    }

    console.log(`  ${pipeline}: 完成 - 成功 ${success}, 失败 ${failed}, 关联 ${linked}/${data.length}`);
    return success;
}

/**
 * 主函数
 */
async function main() {
    console.log('========================================');
    console.log('导入 V9 素材到 processed_data（增强版）');
    console.log('========================================\n');

    try {
        // 加载视频标题映射
        console.log('加载视频标题映射...');
        const videoMap = await loadVideoToRawDataMap();

        // 导入所有管道
        const pipelines = ['sft', 'rag', 'dpo', 'story', 'content'];
        let totalSuccess = 0;

        for (const pipeline of pipelines) {
            console.log(`\n处理 ${pipeline}...`);
            const count = await importMaterials(pipeline, videoMap);
            totalSuccess += count;
        }

        // 验证结果
        const count = await pool.query('SELECT COUNT(*) FROM processed_data');
        console.log(`\n验证：processed_data 表现在有 ${count.rows[0].count} 条记录`);

        // 统计关联情况
        const linked = await pool.query(`
            SELECT COUNT(*) as linked
            FROM processed_data
            WHERE raw_data_id IS NOT NULL
        `);
        const unlinked = await pool.query(`
            SELECT COUNT(*) as unlinked
            FROM processed_data
            WHERE raw_data_id IS NULL
        `);

        console.log(`\n关联情况：${linked.rows[0].linked} 条已关联，${unlinked.rows[0].unlinked} 条未关联`);

        // 统计关联率
        const total = parseInt(count.rows[0].count);
        const linkedCount = parseInt(linked.rows[0].linked);
        const rate = ((linkedCount / total) * 100).toFixed(1);
        console.log(`关联率：${rate}%`);

        await pool.end();
        console.log('\n✓ 完成');
    } catch (err) {
        console.error('错误:', err);
        await pool.end();
        process.exit(1);
    }
}

main();
