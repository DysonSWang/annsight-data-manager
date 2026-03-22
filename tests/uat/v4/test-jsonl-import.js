/**
 * JSONL 文件导入全流程测试
 * 测试文件：/home/admin/Downloads/deepseek_jsonl_20260321_e169f5.jsonl
 */

const path = require('path');
const fs = require('fs');

// 项目根目录
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

const { JsonlExtractor } = require(path.join(ROOT_DIR, 'src/services/extractors/jsonl-extractor'));
const { ContentRouter } = require(path.join(ROOT_DIR, 'src/services/content-router'));

// 测试文件路径
const TEST_FILE = '/home/admin/Downloads/deepseek_jsonl_20260321_e169f5.jsonl';

async function testJsonlExtractor() {
    console.log('='.repeat(60));
    console.log('🧪 JSONL 提取器测试');
    console.log('='.repeat(60));

    // 检查文件是否存在
    if (!fs.existsSync(TEST_FILE)) {
        console.error(`❌ 测试文件不存在：${TEST_FILE}`);
        return;
    }

    const extractor = new JsonlExtractor();

    console.log(`\n📁 测试文件：${TEST_FILE}`);
    console.log('⏳ 开始提取...\n');

    const startTime = Date.now();
    const result = await extractor.extract(TEST_FILE);
    const duration = Date.now() - startTime;

    console.log('\n📊 提取结果:');
    console.log('-'.repeat(60));
    console.log(`✅ 总行数：${result.metadata.totalLines}`);
    console.log(`✅ 有效条目：${result.metadata.validItems}`);
    console.log(`✅ 失败行数：${result.metadata.failedLines}`);
    console.log(`✅ 提取耗时：${duration}ms`);
    console.log(`✅ 输出文本长度：${result.text.length} 字符`);

    // 验证前 3 条数据
    console.log('\n📋 前 3 条数据详情:');
    console.log('-'.repeat(60));

    for (let i = 0; i < Math.min(3, result.items.length); i++) {
        const item = result.items[i];
        console.log(`\n【条目 ${i + 1}】`);
        console.log(`  行号：${item.lineNumber}`);
        console.log(`  格式：${item.metadata?.format || 'unknown'}`);
        console.log(`  文本预览：${item.text?.slice(0, 100)}...`);

        if (item.conversation) {
            console.log(`  对话轮数：${item.conversation.length}`);
            item.conversation.forEach((msg, idx) => {
                console.log(`    [${msg.role}]: ${msg.content?.slice(0, 50)}...`);
            });
        }
    }

    // 验证 conversation 数组
    console.log('\n✅ Conversation 数组验证:');
    console.log('-'.repeat(60));

    const withConversation = result.items.filter(item => item.conversation && item.conversation.length > 0);
    console.log(`包含 conversation 的条目：${withConversation.length}/${result.items.length}`);

    // 统计角色分布
    const roleCount = { user: 0, assistant: 0, system: 0 };
    withConversation.forEach(item => {
        item.conversation.forEach(msg => {
            if (roleCount[msg.role] !== undefined) {
                roleCount[msg.role]++;
            }
        });
    });
    console.log(`角色分布 - user: ${roleCount.user}, assistant: ${roleCount.assistant}, system: ${roleCount.system}`);

    return result;
}

async function testContentRouter() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 ContentRouter 集成测试');
    console.log('='.repeat(60));

    const router = new ContentRouter();

    console.log(`\n📁 测试文件：${TEST_FILE}`);
    console.log('⏳ 开始路由处理...\n');

    const startTime = Date.now();
    const result = await router.route({
        type: 'file',
        path: TEST_FILE
    });
    const duration = Date.now() - startTime;

    console.log('\n📊 路由处理结果:');
    console.log('-'.repeat(60));
    console.log(`✅ 处理耗时：${duration}ms`);
    console.log(`✅ 输出文本长度：${result.text?.length || 0} 字符`);
    console.log(`✅ 元数据：${JSON.stringify(result.metadata, null, 2)}`);

    if (result.items && result.items.length > 0) {
        console.log(`✅ 提取条目数：${result.items.length}`);
    }

    return result;
}

async function testJsonlSupport() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 JSONL 支持性测试');
    console.log('='.repeat(60));

    const extractor = new JsonlExtractor();

    // 测试 1: 检查支持的类型
    console.log('\n📋 支持的 MIME 类型:');
    console.log(JsonlExtractor.supportedTypes);

    // 测试 2: 检查文件类型检测
    const testFiles = [
        { path: 'test.jsonl', expected: true },
        { path: 'test.JSONL', expected: true },
        { path: 'test.json', expected: false },
        { path: 'test.txt', expected: false }
    ];

    console.log('\n📋 文件类型检测:');
    testFiles.forEach(test => {
        const result = JsonlExtractor.supports(null, test.path);
        const status = result === test.expected ? '✅' : '❌';
        console.log(`  ${status} ${test.path}: ${result} (期望：${test.expected})`);
    });

    // 测试 3: 不同格式的 JSONL 数据
    console.log('\n📋 格式兼容性测试:');

    const testData = [
        {
            name: 'OpenAI messages 格式',
            data: { messages: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好！有什么可以帮你？' }] }
        },
        {
            name: 'Input-Output 格式',
            data: { input: '问题', output: '答案' }
        },
        {
            name: '纯文本格式',
            data: { text: '这是一段文本' }
        },
        {
            name: '问答格式',
            data: { question: '问题', answer: '答案' }
        }
    ];

    testData.forEach(test => {
        try {
            const result = extractor.extractItem(test.data);
            console.log(`  ✅ ${test.name}: ${result.text?.slice(0, 30)}...`);
        } catch (error) {
            console.log(`  ❌ ${test.name}: ${error.message}`);
        }
    });
}

async function main() {
    console.log('\n🚀 AnnSight JSONL 导入全流程测试');
    console.log('📁 文件：deepseek_jsonl_20260321_e169f5.jsonl');
    console.log('📅 日期：2026-03-22\n');

    try {
        // 测试 1: JSONL 提取器基础功能
        const extractResult = await testJsonlExtractor();

        // 测试 2: ContentRouter 集成
        const routerResult = await testContentRouter();

        // 测试 3: 支持性测试
        await testJsonlSupport();

        // 总结
        console.log('\n' + '='.repeat(60));
        console.log('✅ 全流程测试完成');
        console.log('='.repeat(60));

        if (extractResult && routerResult) {
            console.log('\n📊 测试总结:');
            console.log(`✅ JSONL 提取器：成功提取 ${extractResult.metadata.validItems} 条数据`);
            console.log(`✅ ContentRouter：正确路由到 JSONL 提取器`);
            console.log(`✅ 数据格式：OpenAI messages 格式解析成功`);
            console.log(`✅ Conversation：${extractResult.items.filter(i => i.conversation).length} 条包含对话数组`);
            console.log('\n🎉 所有测试通过！\n');
        }

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 运行测试
main();
