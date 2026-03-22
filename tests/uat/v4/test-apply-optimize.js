/**
 * 测试应用优化 API
 */
const API_BASE = 'http://localhost:3000/api';

async function main() {
    console.log('='.repeat(70));
    console.log('✨ 测试应用优化 API');
    console.log('='.repeat(70));

    const axios = require('axios');

    // 步骤 1: 获取一条数据
    console.log('\n【步骤 1】获取待审核数据');

    try {
        const lowConfResponse = await axios.get(`${API_BASE}/review/processed/low-confidence?pageSize=1`);

        if (lowConfResponse.data.data.length === 0) {
            console.log('⚠️ 暂无待审核数据');
            return;
        }

        const testData = lowConfResponse.data.data[0];
        console.log(`✅ 测试数据 ID: ${testData.id}`);
        console.log(`   标题：${testData.title}`);

        // 步骤 2: 调用优化 API
        console.log('\n【步骤 2】调用优化 API 生成优化建议');

        const requirements = '测试优化功能';
        const optimizeResponse = await axios.post(
            `${API_BASE}/review/processed/${testData.id}/optimize`,
            { requirements },
            { timeout: 30000 }
        );

        console.log('✅ 优化生成成功');
        console.log(`   优化说明：${optimizeResponse.data.optimizationNote}`);

        // 步骤 3: 应用优化
        console.log('\n【步骤 3】应用优化到数据库');
        console.log('   发送请求:', JSON.stringify({
            optimizedData: optimizeResponse.data.optimized
        }, null, 2));

        const applyResponse = await axios.post(
            `${API_BASE}/review/processed/${testData.id}/apply-optimization`,
            { optimizedData: optimizeResponse.data.optimized },
            { timeout: 30000 }
        );

        console.log('✅ 应用成功!');
        console.log(`   响应：${JSON.stringify(applyResponse.data)}`);

        console.log('\n✅ 测试通过!\n');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        if (error.response?.data) {
            console.error('   响应:', JSON.stringify(error.response.data, null, 2));
        }
        if (error.response?.status === 400) {
            console.error('   请求参数:', JSON.stringify({
                optimizedData: error.config?.data ? JSON.parse(error.config.data) : {}
            }, null, 2));
        }
        process.exit(1);
    }
}

main();
