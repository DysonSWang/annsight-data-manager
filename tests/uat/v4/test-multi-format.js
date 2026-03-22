/**
 * AnnSight v4.0 多格式内容提取 UAT 测试
 * 测试多格式上传、提取器、下载器等功能
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 项目根目录（tests/uat/v4 的上级目录）
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

// 导入被测试模块
const { ContentRouter } = require(path.join(ROOT_DIR, 'src/services/content-router'));
const { TextExtractor } = require(path.join(ROOT_DIR, 'src/services/extractors/text-extractor'));
const { JsonExtractor } = require(path.join(ROOT_DIR, 'src/services/extractors/json-extractor'));
const { JsonlExtractor } = require(path.join(ROOT_DIR, 'src/services/extractors/jsonl-extractor'));
const { initDownloaders, identifyPlatform } = require(path.join(ROOT_DIR, 'src/services/downloaders/registry'));

// 测试统计
const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
};

// 测试辅助函数
function test(name, fn) {
    stats.total++;
    try {
        fn();
        stats.passed++;
        stats.details.push({ name, status: 'passed' });
        console.log(`  ✅ ${name}`);
    } catch (error) {
        stats.failed++;
        stats.details.push({ name, status: 'failed', error: error.message });
        console.log(`  ❌ ${name}: ${error.message}`);
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `期望 ${expected}, 实际 ${actual}`);
    }
}

function assertTrue(condition, message) {
    if (!condition) {
        throw new Error(message || '期望为 true');
    }
}

// ============================================
// 1. 下载器平台识别测试
// ============================================
console.log('\n📋 测试组 1: 下载器平台识别');
initDownloaders();

test('识别知乎链接', () => {
    assertEqual(identifyPlatform('https://www.zhihu.com/question/123456'), 'zhihu');
});

test('识别知乎视频链接', () => {
    assertEqual(identifyPlatform('https://www.zhihu.com/zvideo/123456'), 'zhihu');
});

test('识别小红书链接', () => {
    assertEqual(identifyPlatform('https://www.xiaohongshu.com/explore/abc'), 'xiaohongshu');
});

test('识别 B 站链接', () => {
    assertEqual(identifyPlatform('https://www.bilibili.com/video/BV123'), 'bilibili');
});

test('识别直接文件链接（图片）', () => {
    assertEqual(identifyPlatform('https://example.com/image.jpg'), 'url');
});

test('识别直接文件链接（视频）', () => {
    assertEqual(identifyPlatform('https://example.com/video.mp4'), 'url');
});

test('通用网页识别', () => {
    assertEqual(identifyPlatform('https://example.com/article'), 'generic');
});

// ============================================
// 2. 文本提取器测试
// ============================================
console.log('\n📋 测试组 2: 文本提取器');

const textExtractor = new TextExtractor();

test('支持文本类型检测', () => {
    assertTrue(TextExtractor.supports('text/plain'));
});

test('支持 CSV 类型检测', () => {
    assertTrue(TextExtractor.supports('text/csv'));
});

test('CSV 提取 - 基本格式', async () => {
    const csvContent = 'name,age,city\n张三，25，北京\n李四，30，上海';
    const result = textExtractor.extractCSV(csvContent);
    assertEqual(result.items.length, 2);
    assertEqual(result.items[0].name, '张三');
});

test('CSV 提取 - 带引号', async () => {
    const csvContent = 'name,description\n"张三","你好，世界"\n"李四","测试，数据"';
    const result = textExtractor.extractCSV(csvContent);
    assertEqual(result.items.length, 2);
    assertEqual(result.items[0].description, '你好，世界');
});

// ============================================
// 3. JSON 提取器测试
// ============================================
console.log('\n📋 测试组 3: JSON 提取器');

const jsonExtractor = new JsonExtractor();

test('支持 JSON 类型检测', () => {
    assertTrue(JsonExtractor.supports('application/json'));
});

test('JSON 自动提取 - 数组格式', async () => {
    const json = [
        { content: '第一条内容' },
        { content: '第二条内容' },
        { content: '第三条内容' }
    ];
    const result = await jsonExtractor.autoExtract(json);
    assertEqual(result.items.length, 3);
});

test('JSON 自动提取 - data 字段', async () => {
    const json = {
        data: [
            { content: '第一条' },
            { content: '第二条' }
        ]
    };
    const result = await jsonExtractor.autoExtract(json);
    assertEqual(result.items.length, 2);
});

test('JSON 自动提取 - items 字段', async () => {
    const json = {
        items: [
            { text: '文本 1' },
            { text: '文本 2' }
        ]
    };
    const result = await jsonExtractor.autoExtract(json);
    assertEqual(result.items.length, 2);
});

test('JSON 自动提取 - 嵌套对象', async () => {
    const json = {
        title: '测试文章',
        author: '张三',
        content: '这是文章内容'
    };
    const result = await jsonExtractor.autoExtract(json);
    assertTrue(result.text.length > 0);
});

test('JSONPath 查询 - 直接路径', () => {
    const json = { data: { content: '测试内容' } };
    const items = jsonExtractor.queryJsonPath(json, '.data.content');
    assertEqual(items.length, 1);
});

test('JSONPath 查询 - 数组遍历', () => {
    const json = { data: [{ content: '1' }, { content: '2' }] };
    const items = jsonExtractor.queryJsonPath(json, '.data[*].content');
    assertEqual(items.length, 2);
});

test('JSONPath 查询 - 递归查找', () => {
    const json = {
        level1: {
            level2: {
                content: '深层内容'
            }
        }
    };
    const items = jsonExtractor.queryJsonPath(json, '..content');
    assertEqual(items.length, 1);
});

// ============================================
// 4. ContentRouter 测试
// ============================================
console.log('\n📋 测试组 4: ContentRouter');

const router = new ContentRouter();

test('检测 txt 文件类型', () => {
    assertEqual(router.detectType('test.txt'), 'text');
});

test('检测 json 文件类型', () => {
    assertEqual(router.detectType('data.json'), 'json');
});

test('检测 mp4 文件类型', () => {
    assertEqual(router.detectType('video.mp4'), 'video');
});

test('检测 mp3 文件类型', () => {
    assertEqual(router.detectType('audio.mp3'), 'audio');
});

test('检测 jpg 文件类型', () => {
    assertEqual(router.detectType('image.jpg'), 'image');
});

test('URL 识别 - http 链接', () => {
    assertTrue(router.isUrl('http://example.com'));
});

test('URL 识别 - https 链接', () => {
    assertTrue(router.isUrl('https://example.com'));
});

test('URL 识别 - 非 URL 文本', () => {
    assertTrue(!router.isUrl('hello world'));
});

test('路由 - 纯文本', async () => {
    const result = await router.route({ type: 'text', text: '测试文本' });
    assertEqual(result.text, '测试文本');
});

// ============================================
// 5. 集成测试
// ============================================
console.log('\n📋 测试组 5: 集成测试');

test('完整流程 - 文本上传', async () => {
    const result = await router.route({ type: 'text', text: '集成测试文本' });
    assertTrue(result.text.includes('集成测试'));
    assertEqual(result.metadata.format, 'text');
});

test('完整流程 - JSON 字符串提取', async () => {
    const jsonContent = JSON.stringify([
        { content: 'JSON 测试 1' },
        { content: 'JSON 测试 2' }
    ]);

    // 写入临时文件
    const tempFile = path.join('/tmp', 'test-json-' + Date.now() + '.json');
    fs.writeFileSync(tempFile, jsonContent);

    try {
        const result = await router.route({ type: 'file', path: tempFile });
        assertEqual(result.items.length, 2);
    } finally {
        fs.unlinkSync(tempFile);
    }
});

// ============================================
// 6. JSONL 提取器测试
// ============================================
console.log('\n📋 测试组 6: JSONL 提取器');

const jsonlExtractor = new JsonlExtractor();

test('支持 JSONL 类型检测', () => {
    assertTrue(JsonlExtractor.supports(null, 'test.jsonl'));
});

test('支持 JSONL 大写扩展名检测', () => {
    assertTrue(JsonlExtractor.supports(null, 'test.JSONL'));
});

test('不支持 JSON 扩展名', () => {
    assertEqual(JsonlExtractor.supports(null, 'test.json'), false);
});

test('JSONL 提取 - OpenAI messages 格式', async () => {
    const jsonlContent = '{"messages": [{"role": "user", "content": "你好"}, {"role": "assistant", "content": "你好！有什么可以帮你？"}]}\n{"messages": [{"role": "user", "content": "再见"}, {"role": "assistant", "content": "再见，祝你愉快！"}]}';
    const tempFile = path.join('/tmp', 'test-jsonl-' + Date.now() + '.jsonl');
    fs.writeFileSync(tempFile, jsonlContent);

    try {
        const result = await jsonlExtractor.extract(tempFile);
        assertEqual(result.items.length, 2);
        assertTrue(result.items[0].conversation !== undefined);
        assertEqual(result.items[0].conversation.length, 2);
    } finally {
        fs.unlinkSync(tempFile);
    }
});

test('JSONL 提取 - Input-Output 格式', async () => {
    const jsonlContent = '{"input": "问题 1", "output": "答案 1"}\n{"input": "问题 2", "output": "答案 2"}';
    const tempFile = path.join('/tmp', 'test-jsonl-io-' + Date.now() + '.jsonl');
    fs.writeFileSync(tempFile, jsonlContent);

    try {
        const result = await jsonlExtractor.extract(tempFile);
        assertEqual(result.items.length, 2);
        assertEqual(result.items[0].text.includes('问题 1'), true);
    } finally {
        fs.unlinkSync(tempFile);
    }
});

test('JSONL 提取 - QA 格式', async () => {
    const jsonlContent = '{"question": "问题 1", "answer": "答案 1"}\n{"question": "问题 2", "answer": "答案 2"}';
    const tempFile = path.join('/tmp', 'test-jsonl-qa-' + Date.now() + '.jsonl');
    fs.writeFileSync(tempFile, jsonlContent);

    try {
        const result = await jsonlExtractor.extract(tempFile);
        assertEqual(result.items.length, 2);
        assertTrue(result.items[0].text.includes('问题：'));
    } finally {
        fs.unlinkSync(tempFile);
    }
});

test('ContentRouter 路由 - JSONL 文件', async () => {
    const jsonlContent = '{"messages": [{"role": "user", "content": "测试问题"}, {"role": "assistant", "content": "测试回答"}]}';
    const tempFile = path.join('/tmp', 'test-jsonl-router-' + Date.now() + '.jsonl');
    fs.writeFileSync(tempFile, jsonlContent);

    try {
        const result = await router.route({ type: 'file', path: tempFile });
        assertEqual(result.items.length, 1);
        assertEqual(result.metadata.format, 'jsonl');
    } finally {
        fs.unlinkSync(tempFile);
    }
});

// ============================================
// 输出测试报告
// ============================================
console.log('\n' + '='.repeat(50));
console.log('📊 UAT 测试报告 - AnnSight v4.0');
console.log('='.repeat(50));
console.log(`总测试数：${stats.total}`);
console.log(`✅ 通过：${stats.passed}`);
console.log(`❌ 失败：${stats.failed}`);
console.log(`通过率：${(stats.passed / stats.total * 100).toFixed(1)}%`);

if (stats.failed > 0) {
    console.log('\n❌ 失败的测试:');
    stats.details.filter(d => d.status === 'failed').forEach(d => {
        console.log(`  - ${d.name}: ${d.error}`);
    });
}

console.log('\n' + '='.repeat(50));

// 退出码
process.exit(stats.failed > 0 ? 1 : 0);
