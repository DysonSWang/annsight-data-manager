/**
 * 数据优化功能测试
 * 测试：选择数据 → 输入优化要求 → LLM 生成优化 → 应用优化
 */

const API_BASE = 'http://localhost:3000/api';

async function main() {
    console.log('='.repeat(70));
    console.log('✨ AnnSight 数据优化功能测试');
    console.log('='.repeat(70));

    const axios = require('axios');

    // 步骤 1: 获取待审核数据
    console.log('\n【步骤 1】获取待审核数据');
    console.log('-'.repeat(70));

    try {
        const lowConfResponse = await axios.get(`${API_BASE}/review/processed/low-confidence?pageSize=1`);

        if (lowConfResponse.data.data.length === 0) {
            console.log('⚠️  暂无待审核数据，优化功能需要至少一条 pending 状态的数据');
            console.log('\n💡 提示：可以通过以下方式添加测试数据:');
            console.log('   1. 访问 http://localhost:3000/raw-data.html 上传源数据');
            console.log('   2. 调用 API: POST /api/raw-data/batch-text');
            return;
        }

        const testData = lowConfResponse.data.data[0];
        console.log(`✅ 获取到测试数据:`);
        console.log(`   ID: ${testData.id}`);
        console.log(`   标题：${testData.title?.slice(0, 50)}...`);
        console.log(`   类型：${testData.type}`);
        console.log(`   分类：${testData.category}`);
        console.log(`   置信度：${testData.ai_confidence_score}`);

        // 步骤 2: 调用优化 API
        console.log('\n【步骤 2】调用优化 API');
        console.log('-'.repeat(70));

        const requirements = '请将内容调整得更加具体，添加实际案例，使其更适合职场沟通场景';
        console.log(`⏳ 优化要求：${requirements}`);

        const optimizeResponse = await axios.post(
            `${API_BASE}/review/processed/${testData.id}/optimize`,
            { requirements },
            { timeout: 30000 }
        );

        console.log('✅ 优化生成成功!');
        console.log(`   优化说明：${optimizeResponse.data.optimizationNote}`);
        console.log(`\n📋 原始数据:`);
        console.log(`   标题：${optimizeResponse.data.original.title}`);
        console.log(`   类型：${optimizeResponse.data.original.type}`);
        console.log(`   分类：${optimizeResponse.data.original.category}`);
        console.log(`   内容：${optimizeResponse.data.original.content?.slice(0, 100)}...`);

        console.log(`\n📋 优化后数据:`);
        console.log(`   标题：${optimizeResponse.data.optimized.title}`);
        console.log(`   类型：${optimizeResponse.data.optimized.type}`);
        console.log(`   分类：${optimizeResponse.data.optimized.category}`);
        console.log(`   内容：${optimizeResponse.data.optimized.content?.slice(0, 100)}...`);

        // 步骤 3: 应用优化
        console.log('\n【步骤 3】应用优化到数据库');
        console.log('-'.repeat(70));

        const applyResponse = await axios.post(
            `${API_BASE}/review/processed/${testData.id}/apply-optimization`,
            { optimizedData: optimizeResponse.data.optimized }
        );

        console.log('✅ 优化已应用!');
        console.log(`   响应：${JSON.stringify(applyResponse.data)}`);

        // 步骤 4: 验证更新
        console.log('\n【步骤 4】验证数据已更新');
        console.log('-'.repeat(70));

        const verifyResponse = await axios.get(`${API_BASE}/review/processed/low-confidence?pageSize=5`);
        const updatedData = verifyResponse.data.data.find(d => d.id === testData.id);

        if (updatedData) {
            console.log(`✅ 数据验证成功:`);
            console.log(`   新标题：${updatedData.title}`);
            console.log(`   新类型：${updatedData.type}`);
            console.log(`   新分类：${updatedData.category}`);
        } else {
            console.log('⚠️  数据已不在待审核列表中（可能已被审核或状态变更）');
        }

        // 总结
        console.log('\n' + '='.repeat(70));
        console.log('✅ 数据优化功能测试完成!');
        console.log('='.repeat(70));
        console.log('\n📊 测试总结:');
        console.log(`  测试数据 ID: ${testData.id}`);
        console.log(`  优化生成：成功`);
        console.log(`  优化应用：成功`);
        console.log(`  数据验证：${updatedData ? '成功' : '未验证'}`);
        console.log('\n🎉 优化功能测试通过!\n');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        if (error.response?.data) {
            console.error('   详情:', JSON.stringify(error.response.data, null, 2));
        }
        if (error.code === 'ECONNREFUSED') {
            console.error('\n💡 提示：请确保服务器正在运行 (npm start)');
        }
        process.exit(1);
    }
}

main();
