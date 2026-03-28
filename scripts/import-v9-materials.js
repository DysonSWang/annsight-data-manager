#!/usr/bin/env node
/**
 * 导入 eq-trainning V9 素材到 annsight 数据库
 *
 * 用法：
 *   node scripts/import-v9-materials.js [pipeline]
 *
 * pipeline: sft, rag, dpo, story, content (或用 all 导入全部)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 配置
const V9_DIR = process.env.V9_DIR || '/home/admin/projects/eq-trainning/t2';
const DATABASE_URL = process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@localhost:5432/${process.env.DB_NAME || 'annsight_data'}`;

// V9 输出文件映射
const PIPELINE_FILES = {
    sft: 'sft_final.jsonl',
    rag: 'rag_knowledge.jsonl',
    dpo: 'dpo_data.jsonl',
    story: 'story_materials.jsonl',
    content: 'content_materials.jsonl'
};

// 类型映射
const MATERIAL_TYPE_MAP = {
    sft: 'sft',
    rag: 'rag',
    dpo: 'dpo',
    story: 'story',
    content: 'content'
};

/**
 * 读取 JSONL 文件
 */
function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`文件不存在：${filePath}`);
        return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    return lines.map(line => {
        try {
            return JSON.parse(line);
        } catch (e) {
            console.warn(`JSON 解析失败：${line.substring(0, 100)}...`);
            return null;
        }
    }).filter(item => item !== null);
}

/**
 * 生成唯一 ID
 */
function generateId(pipeline, index, sourceVideo) {
    // 使用 source_video + 索引 作为 ID 基础
    const videoId = sourceVideo
        ? sourceVideo.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)
        : `unknown_${Date.now()}`;
    return `v9_${pipeline}_${videoId}_${index}`;
}

/**
 * 转换 V9 素材为 processed_data 格式
 */
function convertToMaterial(item, pipeline, index) {
    const materialType = MATERIAL_TYPE_MAP[pipeline];

    // 不同类型的转换逻辑
    switch (pipeline) {
        case 'sft':
            return convertSft(item, index);
        case 'rag':
            return convertRag(item, index);
        case 'dpo':
            return convertDpo(item, index);
        case 'story':
            return convertStory(item, index);
        case 'content':
            return convertContent(item, index);
        default:
            return null;
    }
}

/**
 * 转换 SFT 数据
 */
function convertSft(item, index) {
    const messages = item.messages || [];
    const userMessage = messages.find(m => m.role === 'user');
    const assistantMessage = messages.find(m => m.role === 'assistant');

    // 提取 content 中的思考过程（使用字符串方法避免正则表达式解析问题）
    let thinking = '';
    let content = '';
    if (assistantMessage && assistantMessage.content) {
        const thinkStart = '<think>';
        const thinkEnd = '</think>';
        const startIdx = assistantMessage.content.indexOf(thinkStart);
        const endIdx = assistantMessage.content.indexOf(thinkEnd);

        if (startIdx !== -1 && endIdx !== -1) {
            thinking = assistantMessage.content.substring(startIdx + thinkStart.length, endIdx).trim();
            content = assistantMessage.content.substring(endIdx + thinkEnd.length).trim();

            // 验证：回答内容不能为空或仅为另一个 <think>
            if (!content || content.startsWith('<think>') || content.length < 20) {
                console.warn(`跳过坏记录 #${index}: 缺少有效回答内容`);
                return null;
            }
        } else {
            content = assistantMessage.content;
        }
    }

    const sourceVideo = item.metadata?.source_video || '未知';

    return {
        id: generateId('sft', index, sourceVideo),
        materialType: 'sft',
        contentType: item.metadata?.content_type || 'B',
        sourceVideo: sourceVideo,
        sourceTimestamp: item.metadata?.source_timestamp || '未知',
        qualityScore: item.metadata?.quality_score || 0.9,
        type: 'sft',
        category: '对话数据',
        title: userMessage?.content?.substring(0, 50) || 'SFT 样本',
        content: content,
        tags: ['sft', '对话'],
        purposes: 'finetuning',  // SFT 用于微调
        conversation: {
            messages: messages,
            thinking: thinking
        }
    };
}

/**
 * 转换 RAG 数据
 */
function convertRag(item, index) {
    const sourceVideo = item.metadata?.source_video || item.source_file?.split('/').pop() || '未知';

    return {
        id: item.id || generateId('rag', index, sourceVideo),
        materialType: 'rag',
        contentType: null,
        sourceVideo: sourceVideo,
        sourceTimestamp: '未知',
        qualityScore: item.metadata?.authenticity_score || 0.9,
        type: item.type || 'unknown',
        category: item.metadata?.category || '通用',
        title: item.name?.replace(/^\[.*?\]\s*/, '') || item.title || 'RAG 知识',
        content: item.content || '',
        tags: item.tags || [],
        purposes: 'rag',  // RAG 用于知识库
        conversation: null
    };
}

/**
 * 转换 DPO 数据
 */
function convertDpo(item, index) {
    const sourceVideo = item.metadata?.source_video || '未知';

    // DPO 数据包含 chosen 和 rejected
    const chosenContent = item.chosen?.content || '';
    const rejectedContent = item.rejected?.content || '';
    const promptContent = item.prompt?.content || '';

    return {
        id: generateId('dpo', index, sourceVideo),
        materialType: 'dpo',
        contentType: null,
        sourceVideo: sourceVideo,
        sourceTimestamp: '未知',
        qualityScore: item.metadata?.quality_score || 0.85,
        type: item.metadata?.type || 'preference',
        category: '偏好数据',
        title: `DPO 样本 #${index}`,
        content: JSON.stringify({
            prompt: promptContent,
            chosen: chosenContent,
            rejected: rejectedContent,
            reason: item.metadata?.reason || ''
        }),
        tags: ['dpo', '偏好'],
        purposes: 'finetuning',  // DPO 用于微调
        conversation: {
            prompt: item.prompt,
            chosen: item.chosen,
            rejected: item.rejected
        }
    };
}

/**
 * 转换故事素材
 */
function convertStory(item, index) {
    const sourceVideo = item.source_video || item.metadata?.source_video || '未知';

    return {
        id: item.id || generateId('story', index, sourceVideo),
        materialType: 'story',
        contentType: null,
        sourceVideo: sourceVideo,
        sourceTimestamp: '未知',
        qualityScore: item.quality_score || 0.85,
        type: item.type || 'story',
        category: item.category || '故事',
        title: item.title || '故事素材',
        content: item.content || JSON.stringify({
            scene: item.scene,
            conflict: item.conflict,
            resolution: item.resolution,
            ending: item.ending,
            principle: item.principle
        }),
        tags: item.tags || ['故事'],
        purposes: 'content_creation',  // 故事用于内容创作
        conversation: null
    };
}

/**
 * 转换内容素材
 */
function convertContent(item, index) {
    const sourceVideo = item.source_video || '未知';

    return {
        id: generateId('content', index, sourceVideo),
        materialType: 'content',
        contentType: null,
        sourceVideo: sourceVideo,
        sourceTimestamp: '未知',
        qualityScore: item.quality_score || 0.85,
        type: item.category || item.type || 'content',
        category: item.category || item.type || '内容',
        title: item.title || '内容素材',
        content: item.content || '',
        tags: item.tags || [],
        purposes: 'content_creation',  // 内容素材用于内容创作
        conversation: null
    };
}

/**
 * 批量导入到数据库
 */
async function importToDatabase(pool, materials, pipeline) {
    console.log(`\n正在导入 ${materials.length} 条 ${pipeline} 数据...`);

    let success = 0;
    let failed = 0;

    for (const material of materials) {
        try {
            const query = `
                INSERT INTO processed_data
                (id, raw_data_id, material_type, content_type, source_video, source_timestamp,
                 quality_score, type, category, title, content, tags, conversation, purposes, review_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending')
                ON CONFLICT (id) DO UPDATE SET
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
                    updated_at = CURRENT_TIMESTAMP
            `;

            const params = [
                material.id,
                null,
                material.materialType,
                material.contentType,
                material.sourceVideo,
                material.sourceTimestamp,
                material.qualityScore,
                material.type,
                material.category,
                material.title,
                material.content,
                material.tags ? JSON.stringify(material.tags) : null,
                material.conversation ? JSON.stringify(material.conversation) : null,
                material.purposes || null
            ];

            await pool.query(query, params);
            success++;

            if (success % 100 === 0) {
                console.log(`  已导入 ${success} 条...`);
            }
        } catch (error) {
            failed++;
            if (failed <= 5) {
                console.warn(`导入失败 (ID: ${material.id}): ${error.message}`);
            }
        }
    }

    console.log(`导入完成：成功 ${success} 条，失败 ${failed} 条`);
    return { success, failed };
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    const targetPipeline = args[0] || 'all';

    console.log('===========================================');
    console.log('V9 素材导入工具');
    console.log('===========================================');
    console.log(`V9 目录：${V9_DIR}`);
    console.log(`目标数据库：${DATABASE_URL.split('@')[1]}`);
    console.log(`导入管道：${targetPipeline}`);

    // 创建数据库连接池
    const pool = new Pool({
        connectionString: DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    try {
        // 测试连接
        await pool.query('SELECT 1');
        console.log('\n数据库连接成功 ✓');

        // 确定要导入的管道
        const pipelines = targetPipeline === 'all'
            ? Object.keys(PIPELINE_FILES)
            : [targetPipeline];

        const results = {};

        for (const pipeline of pipelines) {
            const filePath = path.join(V9_DIR, PIPELINE_FILES[pipeline]);
            console.log(`\n--- 处理 ${pipeline} 管道 ---`);
            console.log(`源文件：${filePath}`);

            // 读取 JSONL
            const rawData = readJsonl(filePath);
            console.log(`读取到 ${rawData.length} 条记录`);

            if (rawData.length === 0) {
                console.log('跳过空文件');
                continue;
            }

            // 转换数据
            const materials = rawData.map((item, index) =>
                convertToMaterial(item, pipeline, index)
            ).filter(m => m !== null);

            console.log(`转换后 ${materials.length} 条有效数据`);

            // 导入数据库
            const result = await importToDatabase(pool, materials, pipeline);
            results[pipeline] = result;
        }

        // 输出汇总
        console.log('\n===========================================');
        console.log('导入汇总');
        console.log('===========================================');

        let totalSuccess = 0;
        let totalFailed = 0;

        for (const [pipeline, result] of Object.entries(results)) {
            console.log(`${pipeline}: 成功 ${result.success}, 失败 ${result.failed}`);
            totalSuccess += result.success;
            totalFailed += result.failed;
        }

        console.log(`\n总计：成功 ${totalSuccess} 条，失败 ${totalFailed} 条`);

        // 查询数据库中的统计
        const statsQuery = `
            SELECT material_type, COUNT(*) as count
            FROM processed_data
            WHERE material_type IN ('sft', 'rag', 'dpo', 'story', 'content')
            GROUP BY material_type
        `;
        const statsResult = await pool.query(statsQuery);

        console.log('\n数据库中的 V9 素材统计:');
        statsResult.rows.forEach(row => {
            console.log(`  ${row.material_type}: ${row.count} 条`);
        });

    } catch (error) {
        console.error('导入失败:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 运行
main().catch(console.error);
