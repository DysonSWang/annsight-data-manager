/**
 * 完整优化流程测试
 * 模拟前端：生成优化 → 应用优化
 */
const API_BASE = 'http://localhost:3000/api';

async function main() {
    console.log('='.repeat(70));
    console.log('✨ 完整优化流程测试');
    console.log('='.repeat(70));

    const axios = require('axios');

    try {
        // 步骤 1: 获取一条数据
        console.log('\n【步骤 1】获取待审核数据');
        const lowConfResponse = await axios.get(`${API_BASE}/review/processed/low-confidence?pageSize=1`);

        if (lowConfResponse.data.data.length === 0) {
            console.log('⚠️ 暂无待审核数据');
            return;
        }

        const testData = lowConfResponse.data.data[0];
        console.log(`✅ 测试数据 ID: ${testData.id}`);
        console.log(`   标题：${testData.title?.slice(0, 50)}`);
        console.log(`   内容：${testData.content?.slice(0, 50)}...`);

        // 步骤 2: 生成优化
        console.log('\n【步骤 2】生成优化建议');
        const requirements = '请将内容整理得更清晰，添加结构化格式';

        const optimizeResponse = await axios.post(
            `${API_BASE}/review/processed/${testData.id}/optimize`,
            { requirements },
            { timeout: 30000 }
        );

        console.log('✅ 优化生成成功');
        console.log(`   success: ${optimizeResponse.data.success}`);
        console.log(`   has optimized: ${!!optimizeResponse.data.optimized}`);
        console.log(`   optimized type: ${typeof optimizeResponse.data.optimized}`);

        if (optimizeResponse.data.optimized) {
            console.log(`   optimized.title: ${optimizeResponse.data.optimized.title?.slice(0, 30)}`);
            console.log(`   optimized.type: ${optimizeResponse.data.optimized.type}`);
            console.log(`   optimized.category: ${optimizeResponse.data.optimized.category}`);
        }

        console.log('\n完整响应:', JSON.stringify(optimizeResponse.data, null, 2).slice(0, 500));

        // 步骤 3: 应用优化
        console.log('\n【步骤 3】应用优化到数据库');

        if (!optimizeResponse.data.optimized) {
            console.log('❌ 优化响应中没有 optimized 字段，无法测试应用');
            return;
        }

        const applyResponse = await axios.post(
            `${API_BASE}/review/processed/${testData.id}/apply-optimization`,
            { optimizedData: optimizeResponse.data.optimized },
            { timeout: 30000 }
        );

        console.log('✅ 应用成功!');
        console.log(`   响应：${JSON.stringify(applyResponse.data)}`);

        console.log('\n' + '='.repeat(70));
        console.log('✅ 完整流程测试通过!');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        if (error.response?.data) {
            console.error('   响应:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

main();
