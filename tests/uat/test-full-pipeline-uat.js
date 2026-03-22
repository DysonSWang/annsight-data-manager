/**
 * AnnSight 数据全流程 UAT 测试
 * 覆盖：源数据上传 → ETL 处理 → 数据审核 → 统计验证
 */

const playwright = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots-full-uat');
const REPORT_PATH = path.join(__dirname, 'FULL-UAT-REPORT.html');

// 测试数据
const TEST_DATA = {
    batchId: `uat-batch-${Date.now()}`,
    texts: [
        '职场沟通中，学会倾听比说话更重要。当同事向你倾诉烦恼时，不要急于给建议，而是要用心理解他的感受。通过点头、眼神交流和简单的回应来表示你在认真听。这种共情式的倾听能让对方感到被理解和重视，从而建立更深层的信任关系。',
        '情绪管理是情商的核心组成部分。当我们感到愤怒或焦虑时，可以尝试深呼吸技巧：吸气 4 秒，屏住呼吸 4 秒，然后缓慢呼气 6 秒。重复 3-5 次，能够迅速降低生理唤醒水平，帮助恢复冷静。',
        '建立良好的人际关系需要主动倾听和真诚赞美。每天至少赞美一个同事或朋友，注意观察他们的优点和努力，用具体的语言表达你的欣赏。具体的赞美更容易让人感到被认可和重视。'
    ]
};

// 测试结果
const testResults = [];
let browser, page, context;

// 辅助函数
async function api(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${BASE_URL}${endpoint}`);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...options.headers }
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ raw: data });
                }
            });
        });

        req.on('error', reject);
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warn' ? '⚠️' : '📌';
    console.log(`${icon} [${timestamp}] ${message}`);
}

async function takeScreenshot(name) {
    try {
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: false });
        return true;
    } catch (e) {
        console.error(`Screenshot ${name} failed:`, e.message);
        return false;
    }
}

// ==================== 测试用例 ====================

async function test_001_源数据批量上传() {
    const testId = 'FULL-001';
    const testName = '源数据批量上传';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 调用 API 上传数据
        const result = await api('/api/raw-data/batch-text', {
            method: 'POST',
            body: {
                texts: TEST_DATA.texts,
                batchId: TEST_DATA.batchId,
                source: 'test'
            }
        });

        // 验证结果
        if (!result.success) throw new Error('上传失败');
        if (result.successCount !== 3) throw new Error(`期望成功 3 条，实际 ${result.successCount}`);

        // 截图：源数据管理页面
        await page.goto(`${BASE_URL}/raw-data.html`);
        await takeScreenshot(`${testId}-upload-success`);

        log(`${testName} 通过`, 'success');
        testResults.push({ id: testId, name: testName, status: 'pass', details: `上传 ${result.successCount} 条数据` });
        return result;
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

async function test_002_源数据列表展示() {
    const testId = 'FULL-002';
    const testName = '源数据列表展示';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 获取源数据列表
        const result = await api(`/api/raw-data/list?batchId=${TEST_DATA.batchId}`);

        if (!result.data || result.data.length !== 3) {
            throw new Error(`期望 3 条数据，实际 ${result.data?.length || 0}`);
        }

        // 验证字段
        const item = result.data[0];
        if (!item.id || !item.source || !item.batch_id || !item.status) {
            throw new Error('数据字段不完整');
        }

        // 截图：源数据列表
        await page.goto(`${BASE_URL}/raw-data.html`);
        await page.waitForTimeout(1000);
        await takeScreenshot(`${testId}-list-display`);

        log(`${testName} 通过`, 'success');
        testResults.push({ id: testId, name: testName, status: 'pass', details: `展示 ${result.data.length} 条数据` });
        return result;
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

async function test_003_加工数据自动生成() {
    const testId = 'FULL-003';
    const testName = '加工数据自动生成';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 等待 ETL 处理完成（异步）
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 获取待审核数据
        const result = await api('/api/review/processed/low-confidence?page=1&pageSize=20');

        // 验证有低置信度数据
        if (!result.data || result.data.length < 1) {
            throw new Error('没有生成加工数据');
        }

        // 验证数据结构
        const item = result.data[0];
        if (!item.ai_confidence_score || !item.type || !item.category) {
            throw new Error('加工数据字段不完整');
        }

        log(`${testName} 通过`, 'success');
        testResults.push({
            id: testId,
            name: testName,
            status: 'pass',
            details: `生成 ${result.data.length} 条加工数据，平均置信度：${(result.data.reduce((s, i) => s + parseFloat(i.ai_confidence_score), 0) / result.data.length * 100).toFixed(0)}%`
        });
        return result;
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

async function test_004_数据审核通过() {
    const testId = 'FULL-004';
    const testName = '数据审核通过';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 获取待审核数据
        const listResult = await api('/api/review/processed/low-confidence?page=1&pageSize=20');
        if (!listResult.data || listResult.data.length === 0) {
            throw new Error('没有待审核数据');
        }

        const item = listResult.data[0];

        // 执行审核通过
        const approveResult = await api('/api/review/processed/decide', {
            method: 'POST',
            body: {
                id: item.id,
                action: 'approve'
            }
        });

        if (!approveResult.success) {
            throw new Error('审核 API 返回失败');
        }

        // 验证状态已更新
        await new Promise(resolve => setTimeout(resolve, 500));
        const statsResult = await api('/api/review/stats/summary');

        if (statsResult.approved < 1) {
            throw new Error('已通过数量未更新');
        }

        // 截图：审核后的统计
        await page.goto(`${BASE_URL}/`);
        await page.waitForTimeout(1000);
        await takeScreenshot(`${testId}-approved-stats`);

        log(`${testName} 通过`, 'success');
        testResults.push({ id: testId, name: testName, status: 'pass', details: `审核通过 ID: ${item.id.slice(-10)}` });
        return approveResult;
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

async function test_005_数据审核拒绝() {
    const testId = 'FULL-005';
    const testName = '数据审核拒绝';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 获取待审核数据
        const listResult = await api('/api/review/processed/low-confidence?page=1&pageSize=20');
        if (!listResult.data || listResult.data.length === 0) {
            throw new Error('没有待审核数据');
        }

        const item = listResult.data[0];

        // 执行审核拒绝
        const rejectResult = await api('/api/review/processed/decide', {
            method: 'POST',
            body: {
                id: item.id,
                action: 'reject',
                rejectReason: 'UAT 测试拒绝原因'
            }
        });

        if (!rejectResult.success) {
            throw new Error('拒绝 API 返回失败');
        }

        // 验证状态已更新
        await new Promise(resolve => setTimeout(resolve, 500));
        const statsResult = await api('/api/review/stats/summary');

        if (statsResult.rejected < 1) {
            throw new Error('已拒绝数量未更新');
        }

        log(`${testName} 通过`, 'success');
        testResults.push({ id: testId, name: testName, status: 'pass', details: `拒绝 ID: ${item.id.slice(-10)}` });
        return rejectResult;
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

async function test_006_批量审核操作() {
    const testId = 'FULL-006';
    const testName = '批量审核操作';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 获取剩余待审核数据
        const listResult = await api('/api/review/processed/low-confidence?page=1&pageSize=20');
        const pendingItems = listResult.data || [];

        if (pendingItems.length === 0) {
            log('没有更多待审核数据，跳过批量测试', 'warn');
            testResults.push({ id: testId, name: testName, status: 'skip', details: '无待审核数据' });
            return;
        }

        // 批量通过（前 2 条）
        const batchSize = Math.min(2, pendingItems.length);
        for (let i = 0; i < batchSize; i++) {
            await api('/api/review/processed/decide', {
                method: 'POST',
                body: { id: pendingItems[i].id, action: 'approve' }
            });
        }

        // 验证
        await new Promise(resolve => setTimeout(resolve, 500));
        const statsResult = await api('/api/review/stats/summary');

        // 截图：批量处理后
        await page.goto(`${BASE_URL}/`);
        await takeScreenshot(`${testId}-batch-complete`);

        log(`${testName} 通过`, 'success');
        testResults.push({ id: testId, name: testName, status: 'pass', details: `批量通过 ${batchSize} 条数据` });
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

async function test_007_统计数据验证() {
    const testId = 'FULL-007';
    const testName = '统计数据验证';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 获取加工数据统计
        const processedStats = await api('/api/review/stats/summary');

        // 获取源数据统计
        const rawStats = await api('/api/raw-data/stats');

        // 验证统计数据的合理性
        if (processedStats.pending < 0 || processedStats.approved < 0 || processedStats.rejected < 0) {
            throw new Error('统计数据异常');
        }

        if (rawStats.total < rawStats.pending) {
            throw new Error('源数据统计异常');
        }

        // 截图：统计看板
        await page.goto(`${BASE_URL}/`);
        await takeScreenshot(`${testId}-final-stats`);

        log(`${testName} 通过`, 'success');
        testResults.push({
            id: testId,
            name: testName,
            status: 'pass',
            details: `源数据 ${rawStats.total} 条，加工数据：待审核${processedStats.pending} 已通过${processedStats.approved} 已拒绝${processedStats.rejected}`
        });
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

async function test_008_前端界面交互() {
    const testId = 'FULL-008';
    const testName = '前端界面交互测试';
    log(`开始测试：${testId} - ${testName}`);

    try {
        // 测试数据审核页面
        await page.goto(`${BASE_URL}/`);
        await page.waitForTimeout(1000);

        // 验证页面加载
        const pendingElem = await page.$('#stat-pending');
        if (!pendingElem) throw new Error('统计卡片未加载');

        // 测试源数据管理页面
        await page.goto(`${BASE_URL}/raw-data.html`);
        await page.waitForTimeout(1000);

        // 验证筛选器
        const filterSource = await page.$('#filter-source');
        if (!filterSource) throw new Error('筛选器未加载');

        // 测试上传模态框
        await page.click('button:has-text("批量上传")');
        await page.waitForTimeout(500);

        const modal = await page.$('#upload-modal.active');
        if (!modal) throw new Error('上传模态框未打开');

        await takeScreenshot(`${testId}-ui-interaction`);

        log(`${testName} 通过`, 'success');
        testResults.push({ id: testId, name: testName, status: 'pass', details: '前端交互正常' });
    } catch (err) {
        log(`${testName} 失败：${err.message}`, 'error');
        testResults.push({ id: testId, name: testName, status: 'fail', error: err.message });
        throw err;
    }
}

// ==================== 主程序 ====================

async function runFullUAT() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 AnnSight 数据全流程 UAT 测试');
    console.log('📋 测试范围：源数据上传 → ETL 处理 → 数据审核 → 统计验证');
    console.log('='.repeat(70) + '\n');

    // 创建截图目录
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }

    // 启动浏览器
    browser = await playwright.chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();

    const startTime = Date.now();
    let passed = 0, failed = 0, skipped = 0;

    try {
        // 按顺序执行测试
        await test_001_源数据批量上传(); passed++;
        await test_002_源数据列表展示(); passed++;
        await test_003_加工数据自动生成(); passed++;
        await test_004_数据审核通过(); passed++;
        await test_005_数据审核拒绝(); passed++;
        await test_006_批量审核操作(); passed++;
        await test_007_统计数据验证(); passed++;
        await test_008_前端界面交互(); passed++;

    } catch (err) {
        console.error('\n❌ 测试中断:', err.message);
        failed++;
    } finally {
        await browser.close();
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // 统计结果
    passed = testResults.filter(r => r.status === 'pass').length;
    failed = testResults.filter(r => r.status === 'fail').length;
    skipped = testResults.filter(r => r.status === 'skip').length;

    // 生成报告
    generateReport({ passed, failed, skipped, duration });

    console.log('\n' + '='.repeat(70));
    console.log(`📊 测试结果：${passed}/${testResults.length} 通过`);
    console.log(`⏱️  测试耗时：${duration}秒`);
    console.log(`📸 截图保存：${SCREENSHOTS_DIR}`);
    console.log(`📄 测试报告：${REPORT_PATH}`);
    console.log('='.repeat(70) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

function generateReport(stats) {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AnnSight 全流程 UAT 测试报告</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               max-width: 1200px; margin: 0 auto; padding: 2rem; background: #f5f5f5; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white; padding: 2rem; border-radius: 10px; margin-bottom: 2rem; }
        .header h1 { margin: 0 0 1rem 0; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
        .summary-card { background: white; padding: 1.5rem; border-radius: 8px; text-align: center; }
        .summary-card .value { font-size: 2.5rem; font-weight: 700; }
        .summary-card .label { color: #666; margin-top: 0.5rem; }
        .summary-card.pass .value { color: #10b981; }
        .summary-card.fail .value { color: #ef4444; }
        .test-item { background: white; padding: 1rem 1.5rem; border-radius: 8px;
                     margin-bottom: 0.75rem; display: flex; align-items: center; gap: 1rem; }
        .test-item.pass { border-left: 4px solid #10b981; }
        .test-item.fail { border-left: 4px solid #ef4444; }
        .test-item.skip { border-left: 4px solid #f59e0b; opacity: 0.7; }
        .test-id { font-family: monospace; background: #f0f0f0; padding: 0.25rem 0.5rem;
                   border-radius: 4px; font-size: 0.85rem; }
        .test-name { flex: 1; font-weight: 600; }
        .test-status { padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; font-weight: 600; }
        .test-status.pass { background: #d1fae5; color: #065f46; }
        .test-status.fail { background: #fee2e2; color: #991b1b; }
        .test-status.skip { background: #fef3c7; color: #92400e; }
        .test-details { color: #666; font-size: 0.9rem; margin-top: 0.25rem; }
        .screenshot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                           gap: 1rem; margin-top: 2rem; }
        .screenshot-item { background: white; padding: 0.5rem; border-radius: 8px; }
        .screenshot-item img { width: 100%; border-radius: 4px; }
        .screenshot-item p { margin: 0.5rem 0 0 0; font-size: 0.85rem; color: #666; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎯 AnnSight 数据全流程 UAT 测试报告</h1>
        <p>测试时间：${new Date().toLocaleString('zh-CN')}</p>
        <p>测试范围：源数据上传 → ETL 处理 → 数据审核 → 统计验证</p>
    </div>

    <div class="summary">
        <div class="summary-card pass">
            <div class="value">${stats.passed}</div>
            <div class="label">✅ 通过</div>
        </div>
        <div class="summary-card fail">
            <div class="value">${stats.failed}</div>
            <div class="label">❌ 失败</div>
        </div>
        <div class="summary-card">
            <div class="value">${stats.skipped}</div>
            <div class="label">⏭️ 跳过</div>
        </div>
        <div class="summary-card">
            <div class="value">${stats.duration}s</div>
            <div class="label">⏱️ 耗时</div>
        </div>
    </div>

    <h2 style="margin-bottom: 1rem;">📋 测试用例详情</h2>
    ${testResults.map(r => `
        <div class="test-item ${r.status}">
            <span class="test-id">${r.id}</span>
            <div>
                <div class="test-name">${r.name}</div>
                <div class="test-details">${r.details || r.error || '-'}</div>
            </div>
            <span class="test-status ${r.status}">${r.status === 'pass' ? '通过' : r.status === 'fail' ? '失败' : '跳过'}</span>
        </div>
    `).join('')}

    <h2 style="margin: 2rem 0 1rem 0;">📸 测试截图</h2>
    <div class="screenshot-grid">
        ${testResults.filter(r => r.status === 'pass').map(r => `
            <div class="screenshot-item">
                <img src="./screenshots-full-uat/${r.id}-*.png" onerror="this.style.display='none'">
                <p>${r.id}: ${r.name}</p>
            </div>
        `).join('')}
    </div>
</body>
</html>`;

    fs.writeFileSync(REPORT_PATH, html);
}

// 运行测试
runFullUAT().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
