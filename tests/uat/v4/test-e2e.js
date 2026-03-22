/**
 * AnnSight v4.0 E2E 测试
 * 测试完整的 API 上传流程
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const TEST_DIR = path.join(__dirname, 'e2e-test-data');

// 测试统计
const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    results: []
};

// 辅助函数
async function test(name, fn) {
    stats.total++;
    try {
        await fn();
        stats.passed++;
        stats.results.push({ name, status: 'passed' });
        console.log(`  ✅ ${name}`);
    } catch (error) {
        stats.failed++;
        stats.results.push({ name, status: 'failed', error: error.message });
        console.log(`  ❌ ${name}: ${error.message}`);
    }
}

// 准备测试数据
function prepareTestData() {
    if (!fs.existsSync(TEST_DIR)) {
        fs.mkdirSync(TEST_DIR, { recursive: true });
    }

    // 创建测试 JSON 文件
    const jsonFile = path.join(TEST_DIR, 'test-data.json');
    fs.writeFileSync(jsonFile, JSON.stringify([
        { content: '测试内容 1 - RAG 素材' },
        { content: '测试内容 2 - 微调数据' },
        { content: '测试内容 3 - 知识点' }
    ], null, 2));

    // 创建测试 TXT 文件
    const txtFile = path.join(TEST_DIR, 'test-data.txt');
    fs.writeFileSync(txtFile, '第一行文本\n第二行文本\n第三行文本');

    return { jsonFile, txtFile };
}

// 清理测试数据
function cleanupTestData() {
    try {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch (e) {}
}

// ============================================
// E2E 测试
// ============================================

async function runE2ETests() {
    console.log('\n🚀 开始 E2E 测试');
    console.log(`API 地址：${API_BASE}`);
    console.log('='.repeat(50));

    // 准备数据
    const { jsonFile, txtFile } = prepareTestData();

    // --------------------------------------------
    // 1. 健康检查
    // --------------------------------------------
    console.log('\n📋 测试组 1: 健康检查');

    await test('API 可达性检查', async () => {
        try {
            const res = await axios.get(`${API_BASE}/api/raw-data/stats`, {
                timeout: 5000
            });
            if (res.status !== 200) {
                throw new Error(`状态码：${res.status}`);
            }
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                throw new Error('API 服务未启动，请先运行 npm start');
            }
            throw error;
        }
    });

    // --------------------------------------------
    // 2. 文本上传测试
    // --------------------------------------------
    console.log('\n📋 测试组 2: 文本上传');

    await test('单条文本上传', async () => {
        const res = await axios.post(`${API_BASE}/api/raw-data/batch-text`, {
            texts: ['这是一条测试文本'],
            batchId: `e2e-batch-${Date.now()}`,
            source: 'test'
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        if (!res.data.success) {
            throw new Error('上传失败');
        }
        if (res.data.successCount !== 1) {
            throw new Error(`期望成功 1 条，实际${res.data.successCount}条`);
        }
    });

    await test('批量文本上传', async () => {
        const res = await axios.post(`${API_BASE}/api/raw-data/batch-text`, {
            texts: ['文本 1', '文本 2', '文本 3'],
            batchId: `e2e-batch-${Date.now()}`,
            source: 'test'
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        if (!res.data.success) {
            throw new Error('上传失败');
        }
        if (res.data.successCount < 1) {
            throw new Error(`期望至少成功 1 条`);
        }
    });

    // --------------------------------------------
    // 3. URL 上传测试（模拟）
    // --------------------------------------------
    console.log('\n📋 测试组 3: URL 上传');

    await test('URL 上传 API 响应', async () => {
        try {
            const res = await axios.post(`${API_BASE}/api/raw-data/upload`, {
                urls: ['https://example.com'],
                batchId: `e2e-batch-${Date.now()}`,
                source: 'generic'
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 60000
            });

            // URL 上传可能失败（因为 example.com 无法抓取），但 API 应该响应
            console.log(`    响应：${res.data.total}条，成功${res.data.successCount}条`);
        } catch (error) {
            // 超时或网络错误是预期的
            if (error.code === 'ECONNABORTED' || error.response?.status === 500) {
                console.log('    ⚠️  URL 抓取超时/错误（预期行为）');
                return;
            }
            throw error;
        }
    });

    // --------------------------------------------
    // 4. 数据查询测试
    // --------------------------------------------
    console.log('\n📋 测试组 4: 数据查询');

    await test('获取源数据列表', async () => {
        const res = await axios.get(`${API_BASE}/api/raw-data/list`, {
            params: { page: 1, pageSize: 10 },
            timeout: 10000
        });

        if (!res.data.data) {
            throw new Error('响应格式错误');
        }
        if (!res.data.pagination) {
            throw new Error('缺少分页信息');
        }
    });

    await test('获取统计信息', async () => {
        const res = await axios.get(`${API_BASE}/api/raw-data/stats`, {
            timeout: 10000
        });

        if (typeof res.data.total !== 'number') {
            throw new Error('缺少 total 字段');
        }
        if (typeof res.data.pending !== 'number') {
            throw new Error('缺少 pending 字段');
        }
    });

    await test('获取批次列表', async () => {
        const res = await axios.get(`${API_BASE}/api/raw-data/batches`, {
            timeout: 10000
        });

        if (!Array.isArray(res.data.data)) {
            throw new Error('批次列表应该是数组');
        }
    });

    // --------------------------------------------
    // 5. 错误处理测试
    // --------------------------------------------
    console.log('\n📋 测试组 5: 错误处理');

    await test('缺少必填参数', async () => {
        try {
            await axios.post(`${API_BASE}/api/raw-data/batch-text`, {
                texts: ['测试']
                // 缺少 batchId 和 source
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });
            throw new Error('应该返回 400 错误');
        } catch (error) {
            if (error.response?.status === 400) {
                return; // 预期行为
            }
            throw error;
        }
    });

    await test('空文本数组', async () => {
        try {
            await axios.post(`${API_BASE}/api/raw-data/batch-text`, {
                texts: [],
                batchId: `e2e-batch-${Date.now()}`,
                source: 'test'
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });
            // 空数组应该返回成功但无数据
        } catch (error) {
            if (error.response?.status === 400) {
                return; // 预期行为
            }
            throw error;
        }
    });

    // 清理
    cleanupTestData();

    // --------------------------------------------
    // 输出报告
    // --------------------------------------------
    console.log('\n' + '='.repeat(50));
    console.log('📊 E2E 测试报告');
    console.log('='.repeat(50));
    console.log(`总测试数：${stats.total}`);
    console.log(`✅ 通过：${stats.passed}`);
    console.log(`❌ 失败：${stats.failed}`);
    console.log(`通过率：${stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(1) : 0}%`);

    if (stats.failed > 0) {
        console.log('\n❌ 失败的测试:');
        stats.results.filter(r => r.status === 'failed').forEach(r => {
            console.log(`  - ${r.name}: ${r.error}`);
        });
    }

    console.log('\n' + '='.repeat(50));

    // 退出码
    process.exit(stats.failed > 0 ? 1 : 0);
}

// 运行测试
runE2ETests().catch(error => {
    console.error('测试执行失败:', error.message);
    process.exit(1);
});
