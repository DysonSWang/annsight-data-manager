const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000/api';

/**
 * SFT 格式导出 UAT 测试
 * 验证导出格式是否匹配用户提供的示例
 */
async function testSFTExport() {
    console.log('============================================================');
    console.log('🧪 SFT 格式导出 UAT 测试');
    console.log('============================================================\n');

    const steps = [];
    let taskId = null;

    try {
        // 步骤 1: 获取现有任务
        console.log('ℹ️ 步骤 1: 获取任务列表');
        const tasksResponse = await axios.get(`${BASE_URL}/finetuning/task`);
        const tasks = tasksResponse.data.tasks;

        if (tasks.length === 0) {
            console.log('⚠️  没有找到现有任务，请先运行完整 UAT 测试创建任务');
            return;
        }

        // 找到已完成审核的任务
        const completedTask = tasks.find(t =>
            t.stats.passed_data > 0 || t.stats.reviewed_data > 0
        ) || tasks[0];

        taskId = completedTask.id;
        console.log(`✅ 使用任务：${taskId} (${completedTask.name})`);
        console.log(`   已通过：${completedTask.stats.passed_data}, 已优化：${completedTask.stats.optimized_data}\n`);
        steps.push({ name: '获取任务', status: 'success', taskId });

        // 步骤 2: 获取任务数据
        console.log('ℹ️ 步骤 2: 获取任务数据');
        const dataResponse = await axios.get(`${BASE_URL}/finetuning/task/${taskId}/data`);
        const data = dataResponse.data.data;
        console.log(`✅ 获取到 ${data.length} 条数据`);

        if (data.length === 0) {
            console.log('⚠️  任务中没有数据');
            return;
        }

        // 显示第一条数据的结构
        const firstData = data[0];
        console.log(`\n📋 数据示例:`);
        console.log(`   ID: ${firstData.id}`);
        console.log(`   类型：${firstData.type}`);
        console.log(`   标题：${firstData.title?.substring(0, 50)}...`);
        console.log(`   有对话数据：${firstData.conversation ? '是' : '否'}`);
        if (firstData.conversation && firstData.conversation.length > 0) {
            console.log(`   对话轮数：${firstData.conversation.length}`);
        }
        steps.push({ name: '获取数据', status: 'success', count: data.length });

        // 步骤 3: 导出 SFT 格式
        console.log('\nℹ️ 步骤 3: 导出 SFT 格式');
        const exportResponse = await axios.get(`${BASE_URL}/finetuning/task/${taskId}/export`, {
            params: { format: 'sft' }
        });

        const exportData = exportResponse.data;
        console.log(`✅ 导出成功：${exportData.count} 条`);
        console.log(`   格式：${exportData.format}`);
        steps.push({ name: 'SFT 导出', status: 'success', count: exportData.count });

        // 步骤 4: 验证格式
        console.log('\nℹ️ 步骤 4: 验证导出格式');

        if (exportData.count > 0) {
            // 解析第一条 JSONL 数据
            const firstLine = exportData.data[0];
            const parsed = typeof firstLine === 'string' ? JSON.parse(firstLine) : firstLine;

            console.log('\n📋 导出格式验证:');

            // 验证必需字段
            const checks = {
                '有 messages 数组': Array.isArray(parsed.messages),
                '有 system 角色': parsed.messages.some(m => m.role === 'system'),
                '有 user 角色': parsed.messages.some(m => m.role === 'user'),
                '有 assistant 角色': parsed.messages.some(m => m.role === 'assistant'),
                'assistant 含 <think> 标签': parsed.messages.some(m =>
                    m.role === 'assistant' && m.content.includes('<think>')
                ),
                '有 metadata': parsed.metadata !== undefined
            };

            let allPassed = true;
            for (const [check, passed] of Object.entries(checks)) {
                const icon = passed ? '✅' : '❌';
                console.log(`   ${icon} ${check}: ${passed ? '是' : '否'}`);
                if (!passed) allPassed = false;
            }

            steps.push({
                name: '格式验证',
                status: allPassed ? 'success' : 'warning',
                checks
            });

            // 步骤 5: 显示示例输出
            console.log('\nℹ️ 步骤 5: 显示示例输出');
            console.log('\n📄 JSONL 示例 (第一条):');

            // 格式化输出以便阅读
            const sampleOutput = {
                messages: parsed.messages.slice(0, 3), // 只显示前 3 条消息
                metadata: parsed.metadata
            };

            console.log(JSON.stringify(sampleOutput, null, 2).substring(0, 1000) + '...');

            // 显示完整的 assistant 消息（包含 <think> 标签）
            const assistantMsg = parsed.messages.find(m => m.role === 'assistant');
            if (assistantMsg) {
                console.log('\n📄 Assistant 消息完整格式:');
                const contentPreview = assistantMsg.content.substring(0, 500);
                console.log(contentPreview + (assistantMsg.content.length > 500 ? '...' : ''));
            }

            steps.push({ name: '示例输出', status: 'success' });

            // 步骤 6: 保存到文件
            console.log('\nℹ️ 步骤 6: 保存到文件');
            const outputPath = '/tmp/sft-export-sample.jsonl';
            const jsonlContent = exportData.data.join('\n');
            fs.writeFileSync(outputPath, jsonlContent, 'utf8');
            console.log(`✅ 已保存到：${outputPath}`);
            console.log(`   文件大小：${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
            steps.push({ name: '保存文件', status: 'success', path: outputPath });
        }

        // 汇总结果
        console.log('\n============================================================');
        console.log('✅ 🎉 测试完成!');
        console.log('============================================================\n');

        console.log('📊 测试结果摘要:');
        console.log(`   任务 ID: ${taskId}`);
        console.log(`   导出条数：${exportData.count}`);
        console.log(`   执行步骤：${steps.length}\n`);

        console.log('📋 步骤详情:');
        steps.forEach((step, i) => {
            const icon = step.status === 'success' ? '✅' : step.status === 'warning' ? '⚠️' : '❌';
            console.log(`   ${i + 1}. ${step.name}: ${icon} ${step.status}`);
        });

        console.log('\n============================================================\n');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        if (error.response) {
            console.error('   状态码:', error.response.status);
            console.error('   响应:', JSON.stringify(error.response.data));
        } else if (error.code === 'ECONNREFUSED') {
            console.error('   无法连接到服务器，请确保服务已启动：npm start');
        }
        process.exit(1);
    }
}

// 运行测试
testSFTExport().catch(console.error);
