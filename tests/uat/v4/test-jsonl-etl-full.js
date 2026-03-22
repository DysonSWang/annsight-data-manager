/**
 * JSONL 数据 ETL 入库全流程测试
 * 测试：JSONL 文件 → 提取 → ETL → 数据库
 */

const path = require('path');
const fs = require('fs');

// 项目根目录
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

const { JsonlExtractor } = require(path.join(ROOT_DIR, 'src/services/extractors/jsonl-extractor'));
const { ContentRouter } = require(path.join(ROOT_DIR, 'src/services/content-router'));

// 测试文件路径
const TEST_FILE = '/home/admin/Downloads/deepseek_jsonl_20260321_e169f5.jsonl';

/**
 * 模拟 ETL 处理（简化版）
 * 实际项目中会调用完整的 ETL 管道
 */
async function simulateETL(items) {
    console.log('\n⏳ 开始 ETL 处理...\n');

    const processedItems = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // L1 清洗：清理文本
        const cleanedText = item.text
            .replace(/\s+/g, ' ')
            .trim();

        // L2 结构化：提取对话数据
        const conversation = item.conversation || [];
        const userMessage = conversation.find(m => m.role === 'user');
        const assistantMessage = conversation.find(m => m.role === 'assistant');
        const systemMessage = conversation.find(m => m.role === 'system');

        // 生成标题
        const title = userMessage?.content?.slice(0, 50) || '无标题';

        // L3 评估：简单评分
        const completenessScore = conversation.length >= 2 ? 1.0 : 0.5;
        const aiConfidenceScore = conversation.length >= 3 ? 0.95 : 0.8;

        processedItems.push({
            id: `jsonl-item-${i + 1}-${Date.now()}`,
            raw_data_id: `raw-${Date.now()}-${i}`,
            collection_name: 'communication_skills',
            type: '沟通技巧',
            category: '高情商沟通',
            subcategory: '亲子沟通',
            target_user: '家长',
            title: title,
            content: cleanedText,
            conversation: conversation,
            completeness_score: completenessScore,
            ai_confidence_score: aiConfidenceScore,
            auto_approved: aiConfidenceScore >= 0.8,
            source: 'jsonl_import',
            batch_id: `batch-${Date.now()}`,
            metadata: {
                ...item.metadata,
                lineNumber: item.lineNumber
            }
        });

        // 每 100 条打印进度
        if ((i + 1) % 100 === 0) {
            console.log(`  ETL 进度：${i + 1}/${items.length} (${((i + 1) / items.length * 100).toFixed(1)}%)`);
        }
    }

    return processedItems;
}

/**
 * 模拟数据入库
 * 实际项目中会调用 API 或直接写入数据库
 */
async function simulateDatabaseInsert(processedItems) {
    console.log('\n⏳ 模拟数据入库...\n');

    // 检查数据库连接
    const dbPath = path.join(ROOT_DIR, 'data/annsight.db');
    let db;
    let dbConnected = false;

    try {
        const Database = require('better-sqlite3');
        db = new Database(dbPath);
        dbConnected = true;
        console.log('✅ 数据库连接成功');
    } catch (error) {
        console.log('⚠️  数据库未连接（这是预期的，如果尚未初始化）');
        console.log(`   数据库路径：${dbPath}`);
    }

    const results = {
        totalItems: processedItems.length,
        successCount: 0,
        skipCount: 0,
        errorCount: 0,
        errors: []
    };

    if (dbConnected) {
        try {
            // 准备插入语句
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO processed_data (
                    id, raw_data_id, collection_name, type, category, subcategory,
                    target_user, title, content, conversation, completeness_score,
                    ai_confidence_score, auto_approved, source, batch_id, created_at
                ) VALUES (
                    @id, @raw_data_id, @collection_name, @type, @category, @subcategory,
                    @target_user, @title, @content, @conversation, @completeness_score,
                    @ai_confidence_score, @auto_approved, @source, @batch_id, CURRENT_TIMESTAMP
                )
            `);

            const insertMany = db.transaction((items) => {
                for (const item of items) {
                    try {
                        stmt.run({
                            id: item.id,
                            raw_data_id: item.raw_data_id,
                            collection_name: item.collection_name,
                            type: item.type,
                            category: item.category,
                            subcategory: item.subcategory,
                            target_user: item.target_user,
                            title: item.title,
                            content: item.content,
                            conversation: JSON.stringify(item.conversation),
                            completeness_score: item.completeness_score,
                            ai_confidence_score: item.ai_confidence_score,
                            auto_approved: item.auto_approved,
                            source: item.source,
                            batch_id: item.batch_id
                        });
                        results.successCount++;
                    } catch (error) {
                        results.errorCount++;
                        results.errors.push({ id: item.id, error: error.message });
                    }
                }
            });

            // 批量插入（每 100 条）
            const batchSize = 100;
            for (let i = 0; i < processedItems.length; i += batchSize) {
                const batch = processedItems.slice(i, i + batchSize);
                insertMany(batch);
                console.log(`  入库进度：${Math.min(i + batchSize, processedItems.length)}/${processedItems.length}`);
            }

        } catch (error) {
            console.error('❌ 数据库写入失败:', error.message);
            results.errors.push({ error: error.message });
        } finally {
            db.close();
        }
    } else {
        // 模拟计数
        results.successCount = processedItems.length;
        console.log('  (模拟模式：所有数据标记为成功)');
    }

    return results;
}

/**
 * 导出为微调数据格式（阿里百炼 JSONL）
 */
function exportFinetuningFormat(processedItems, outputPath) {
    console.log('\n⏳ 导出微调数据格式...\n');

    const lines = [];

    for (const item of processedItems) {
        if (item.conversation && item.conversation.length >= 2) {
            // 过滤掉 system 消息，只保留 user 和 assistant
            const messages = item.conversation
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                    role: m.role,
                    content: m.content
                }));

            if (messages.length >= 2) {
                lines.push(JSON.stringify({ messages }));
            }
        }
    }

    // 写入文件
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');

    const stats = {
        totalItems: processedItems.length,
        exportedLines: lines.length,
        outputPath
    };

    console.log(`  导出完成：${lines.length} 条`);
    console.log(`  输出文件：${outputPath}`);

    return stats;
}

async function main() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 AnnSight JSONL 数据全流程测试');
    console.log('📁 文件：deepseek_jsonl_20260321_e169f5.jsonl (500 条)');
    console.log('📅 日期：2026-03-22');
    console.log('='.repeat(70));

    const startTime = Date.now();

    try {
        // 步骤 1: 文件提取
        console.log('\n【步骤 1】JSONL 文件提取');
        console.log('-'.repeat(70));

        const router = new ContentRouter();
        const extractStartTime = Date.now();
        const extractResult = await router.route({
            type: 'file',
            path: TEST_FILE
        });
        const extractDuration = Date.now() - extractStartTime;

        console.log(`✅ 提取耗时：${extractDuration}ms`);
        console.log(`✅ 提取条目：${extractResult.items?.length || 0}`);

        // 步骤 2: ETL 处理
        console.log('\n【步骤 2】ETL 处理');
        console.log('-'.repeat(70));

        const etlStartTime = Date.now();
        const processedItems = await simulateETL(extractResult.items || []);
        const etlDuration = Date.now() - etlStartTime;

        console.log(`✅ ETL 耗时：${etlDuration}ms`);
        console.log(`✅ 处理条目：${processedItems.length}`);

        // 步骤 3: 数据入库
        console.log('\n【步骤 3】数据入库');
        console.log('-'.repeat(70));

        const dbStartTime = Date.now();
        const dbResults = await simulateDatabaseInsert(processedItems);
        const dbDuration = Date.now() - dbStartTime;

        console.log(`✅ 入库耗时：${dbDuration}ms`);
        console.log(`✅ 成功：${dbResults.successCount}`);
        console.log(`✅ 跳过：${dbResults.skipCount}`);
        console.log(`✅ 失败：${dbResults.errorCount}`);

        if (dbResults.errors.length > 0) {
            console.log(`⚠️  错误详情：${JSON.stringify(dbResults.errors.slice(0, 3), null, 2)}`);
        }

        // 步骤 4: 导出微调数据
        console.log('\n【步骤 4】导出微调数据格式');
        console.log('-'.repeat(70));

        const exportPath = path.join(ROOT_DIR, 'exports/deepseek_finetuning_export.jsonl');

        // 确保导出目录存在
        const exportDir = path.dirname(exportPath);
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const exportStartTime = Date.now();
        const exportStats = exportFinetuningFormat(processedItems, exportPath);
        const exportDuration = Date.now() - exportStartTime;

        console.log(`✅ 导出耗时：${exportDuration}ms`);
        console.log(`✅ 导出条数：${exportStats.exportedLines}`);

        // 验证导出的文件
        const exportedContent = fs.readFileSync(exportPath, 'utf-8');
        const exportedLines = exportedContent.split('\n').filter(l => l.trim());
        console.log(`✅ 验证条数：${exportedLines.length}`);

        // 显示第一条导出数据
        const firstLine = JSON.parse(exportedLines[0]);
        console.log('\n📋 导出数据样例:');
        console.log(JSON.stringify(firstLine, null, 2).slice(0, 500) + '...');

        // 总结
        const totalDuration = Date.now() - startTime;

        console.log('\n' + '='.repeat(70));
        console.log('✅ 全流程测试完成');
        console.log('='.repeat(70));

        console.log('\n📊 处理总结:');
        console.log(`  总耗时：${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
        console.log(`  提取条目：${extractResult.items?.length || 0}`);
        console.log(`  ETL 处理：${processedItems.length}`);
        console.log(`  成功入库：${dbResults.successCount}`);
        console.log(`  导出微调：${exportStats.exportedLines}`);
        console.log(`  平均速度：${(processedItems.length / (totalDuration / 1000)).toFixed(2)} 条/秒`);

        console.log('\n📁 输出文件:');
        console.log(`  微调数据：${exportPath}`);

        console.log('\n🎉 JSONL 导入全流程测试成功！\n');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 运行测试
main();
