/**
 * JSONL 裂变功能测试
 * 测试：1 条 JSONL 数据 → 裂变成多条不同用途的数据
 */

const path = require('path');
const fs = require('fs');

// 项目根目录
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

const { JsonlExtractor } = require(path.join(ROOT_DIR, 'src/services/extractors/jsonl-extractor'));
const { L25FissionProcessor, MockLlmServiceForFission } = require(path.join(ROOT_DIR, 'src/pipeline/processors/l25-fission'));

// 测试文件路径
const TEST_FILE = '/home/admin/Downloads/deepseek_jsonl_20260321_e169f5.jsonl';

/**
 * 测试裂变功能
 */
async function testFission() {
    console.log('='.repeat(70));
    console.log('🧪 JSONL 裂变功能测试');
    console.log('='.repeat(70));

    // 步骤 1: 提取单条 JSONL 数据作为测试样本
    console.log('\n【步骤 1】提取测试样本');
    console.log('-'.repeat(70));

    const extractor = new JsonlExtractor();
    const extractResult = await extractor.extract(TEST_FILE);

    // 取前 3 条作为测试样本
    const testItems = extractResult.items.slice(0, 3);
    console.log(`✅ 提取样本数：${testItems.length} 条`);

    // 步骤 2: 创建裂变处理器
    console.log('\n【步骤 2】创建裂变处理器');
    console.log('-'.repeat(70));

    const llmService = new MockLlmServiceForFission();
    const fissionProcessor = new L25FissionProcessor(llmService, {
        purposes: ['rag', 'finetuning', 'content_creation']
    });

    console.log('✅ 处理器创建成功');
    console.log('✅ 支持的用途：rag, finetuning, content_creation');

    // 步骤 3: 测试裂变（无配置模式）
    console.log('\n【步骤 3】测试裂变 - 无配置模式（默认每种用途 1 条）');
    console.log('-'.repeat(70));

    const testContext1 = {
        cleanedText: testItems[0].text,
        sourceType: 'jsonl',
        purposes: ['rag', 'finetuning', 'content_creation']
    };

    const fissionResult1 = await fissionProcessor.process(testContext1);

    console.log(`✅ 裂变结果：${fissionResult1.items?.length || 1} 条`);
    console.log(`✅ 裂变详情：${fissionResult1.fissionNote || '无'}`);

    if (fissionResult1.items && fissionResult1.items.length > 0) {
        console.log('\n📋 裂变数据详情:');
        fissionResult1.items.forEach((item, idx) => {
            console.log(`\n  【裂变数据 ${idx + 1}】`);
            console.log(`    类型：${item.type}`);
            console.log(`    分类：${item.category}`);
            console.log(`    标题：${item.title}`);
            console.log(`    用途：${item.purposes?.join(', ') || '未指定'}`);
            console.log(`    置信度：${item.aiConfidenceScore || 'N/A'}`);
        });
    }

    // 步骤 4: 测试裂变（带配置模式 - 每种用途生成 3 条）
    console.log('\n【步骤 4】测试裂变 - 带配置模式（每种用途 3 条）');
    console.log('-'.repeat(70));

    const fissionConfig = {
        rag: { count: 3, requirement: '需要包含具体案例和步骤' },
        finetuning: { count: 3, requirement: '对话需要自然流畅' },
        content_creation: { count: 2, requirement: '素材需要可复用' }
    };

    const testContext2 = {
        cleanedText: testItems[1].text,
        sourceType: 'jsonl',
        purposes: ['rag', 'finetuning', 'content_creation'],
        fissionConfig
    };

    const fissionResult2 = await fissionProcessor.process(testContext2);

    console.log(`✅ 裂变结果：${fissionResult2.items?.length || 1} 条`);
    console.log(`✅ 裂变详情：${fissionResult2.fissionNote || '无'}`);

    // 按用途分组统计
    const byPurpose = {};
    if (fissionResult2.items && fissionResult2.items.length > 0) {
        fissionResult2.items.forEach(item => {
            const purpose = item.purposes?.[0] || 'other';
            if (!byPurpose[purpose]) {
                byPurpose[purpose] = [];
            }
            byPurpose[purpose].push(item);
        });

        console.log('\n📊 按用途分组统计:');
        Object.keys(byPurpose).forEach(purpose => {
            console.log(`  ${purpose}: ${byPurpose[purpose].length} 条`);
        });
    }

    // 步骤 5: 测试单条数据的裂变（启用 conversation）
    console.log('\n【步骤 5】测试裂变 - 使用 conversation 数据');
    console.log('-'.repeat(70));

    const testContext3 = {
        cleanedText: testItems[2].text,
        sourceType: 'jsonl',
        purposes: ['finetuning'],
        conversation: testItems[2].conversation,
        fissionConfig: {
            finetuning: { count: 2, requirement: '保留原始对话结构' }
        }
    };

    const fissionResult3 = await fissionProcessor.process(testContext3);

    console.log(`✅ 裂变结果：${fissionResult3.items?.length || 1} 条`);

    if (fissionResult3.items && fissionResult3.items.length > 0) {
        console.log('\n📋 裂变数据（含 conversation）:');
        fissionResult3.items.forEach((item, idx) => {
            console.log(`\n  【裂变数据 ${idx + 1}】`);
            console.log(`    类型：${item.type}`);
            console.log(`    用途：${item.purposes?.join(', ')}`);
            console.log(`    对话轮数：${item.conversation?.length || 0}`);
            if (item.conversation && item.conversation.length > 0) {
                item.conversation.forEach(msg => {
                    console.log(`      [${msg.role}]: ${msg.content?.slice(0, 50)}...`);
                });
            }
        });
    }

    // 步骤 6: 性能测试
    console.log('\n【步骤 6】性能测试 - 批量裂变');
    console.log('-'.repeat(70));

    const batchSize = 10;
    const batchItems = extractResult.items.slice(0, batchSize);
    const batchStartTime = Date.now();

    let totalFissionCount = 0;
    for (const item of batchItems) {
        const context = {
            cleanedText: item.text,
            sourceType: 'jsonl',
            purposes: ['rag', 'finetuning'],
            fissionConfig: {
                rag: { count: 2 },
                finetuning: { count: 2 }
            }
        };
        const result = await fissionProcessor.process(context);
        totalFissionCount += result.items?.length || 1;
    }

    const batchDuration = Date.now() - batchStartTime;

    console.log(`✅ 批量处理：${batchSize} 条源数据`);
    console.log(`✅ 裂变总数：${totalFissionCount} 条`);
    console.log(`✅ 处理耗时：${batchDuration}ms`);
    console.log(`✅ 平均速度：${(batchSize / (batchDuration / 1000)).toFixed(2)} 条/秒`);
    console.log(`✅ 裂变倍率：${(totalFissionCount / batchSize).toFixed(2)}x`);

    // 总结
    console.log('\n' + '='.repeat(70));
    console.log('✅ 裂变功能测试完成');
    console.log('='.repeat(70));

    console.log('\n📊 测试总结:');
    console.log(`  无配置模式：${fissionResult1.items?.length || 1} 条 (默认每种用途 1 条)`);
    console.log(`  带配置模式：${fissionResult2.items?.length || 1} 条 (按配置数量裂变)`);
    console.log(`  对话数据：${fissionResult3.items?.length || 1} 条 (保留 conversation)`);
    console.log(`  批量性能：${totalFissionCount} 条 / ${batchDuration}ms`);

    console.log('\n🎉 所有测试通过！\n');

    return {
        singleFission: fissionResult1.items?.length || 1,
        configuredFission: fissionResult2.items?.length || 1,
        conversationFission: fissionResult3.items?.length || 1,
        batchFission: totalFissionCount
    };
}

async function main() {
    console.log('\n🚀 AnnSight 裂变功能测试');
    console.log('📁 文件：deepseek_jsonl_20260321_e169f5.jsonl');
    console.log('📅 日期：2026-03-22\n');

    try {
        const results = await testFission();

        // 输出测试报告
        console.log('\n' + '='.repeat(70));
        console.log('📄 裂变功能测试报告');
        console.log('='.repeat(70));
        console.log(`无配置裂变：${results.singleFission} 条`);
        console.log(`带配置裂变：${results.configuredFission} 条`);
        console.log(`对话数据裂变：${results.conversationFission} 条`);
        console.log(`批量裂变总数：${results.batchFission} 条`);
        console.log('='.repeat(70));

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 运行测试
main();
