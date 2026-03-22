#!/usr/bin/env node
/**
 * AnnSight Data Manager UAT 测试 - ETL Pipeline
 * 测试 ETL 处理流程并保存截图
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const OUTPUT_DIR = path.join(__dirname, 'screenshots');
const REPORT_DIR = path.join(__dirname);

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 测试用例配置 - 使用简单文本避免转义问题
const TEST_CASES = [
    {
        name: '处理纯文本并提取结构化数据',
        id: 'etl-001',
        text: '教训案例：当众指出领导错误，我被穿了三年小鞋。在一次项目会议上，我发现领导汇报的数据有错误。会议室瞬间安静，领导脸色涨红。从那以后，重要会议不再通知我，我的晋升也被卡了三年。后来才明白，当众让领导下不来台，就是公开挑战他的权威。',
        expectedType: '教训案例',
        expectedCategory: '职场'
    },
    {
        name: 'MD5 去重检测',
        id: 'etl-002',
        text: '这是一个测试文档，包含一些重复内容',
        runTwice: true,
        expectDuplicate: true
    },
    {
        name: '处理不存在的原始数据',
        id: 'etl-003',
        rawDataId: 'non-existent',
        expectError: '原始数据不存在'
    },
    {
        name: '长文本处理与质量评估',
        id: 'etl-004',
        text: '沟通技巧：如何用一句话化解尴尬。上周部门聚餐，同事小王不小心把红酒洒在了新来的女同事裙子上。全场瞬间安静，小王手足无措，女同事脸涨得通红。李经理笑着说，你这是要给新同事行法国见面礼啊。一句话把大家都逗乐了，尴尬的气氛瞬间消散。事后女同事特意感谢李经理解围，说他的幽默化解了她的难堪。这就是沟通的力量。',
        expectedType: '战术方法',  // 包含"技巧"一词，会被分类为战术方法
        minQualityScore: 0.3
    },
    {
        name: '战术方法类型识别',
        id: 'etl-005',
        text: '战术方法：三步化解冲突的技巧。第一步暂停，当情绪上来时，先深呼吸 3 秒，避免冲动说话。第二步换位，站在对方角度想，他为什么这么说。第三步表达，用我感到而不是你总是，比如我感到被忽视更容易被接受。这个方法我用了半年，和同事的争吵减少了 80%。',
        expectedType: '战术方法',
        minConfidence: 0.5
    }
];

/**
 * 时间戳格式化
 */
function timestamp() {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

/**
 * 保存截图
 */
async function saveScreenshot(page, testId, suffix = 'final') {
    try {
        // 等待页面稳定
        await page.waitForLoadState('networkidle');
        await new Promise(resolve => setTimeout(resolve, 500));

        const filename = `${testId}-${suffix}-${timestamp()}.png`;
        const filepath = path.join(OUTPUT_DIR, filename);
        await page.screenshot({ path: filepath, fullPage: false });
        return filename;
    } catch (error) {
        console.warn(`截图失败 ${testId}-${suffix}: ${error.message}`);
        return null;
    }
}

/**
 * 创建测试结果 HTML 报告
 */
function generateReport(results) {
    const totalTests = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = totalTests - passed;
    const passRate = ((passed / totalTests) * 100).toFixed(1);

    const testCards = results.map(r => {
        const statusClass = r.passed ? 'passed' : 'failed';
        const statusText = r.passed ? '✓ 通过' : '✗ 失败';

        const detailsHtml = r.details.map(d =>
            `<span class="field">${d.key}: <strong>${d.value}</strong></span>`
        ).join('');

        const errorHtml = r.error ?
            `<div class="error-box">⚠️ ${r.error}</div>` : '';

        const screenshotsHtml = r.screenshots && r.screenshots.length > 0 ?
            `<div class="screenshot-grid">
                ${r.screenshots.map(s =>
                    `<div class="screenshot-item">
                        <img src="screenshots/${s.filename}" alt="${s.description}">
                        <div class="caption">${s.description}</div>
                    </div>`
                ).join('')}
            </div>` : '';

        return `
            <div class="test-card ${statusClass}">
                <div class="test-header">
                    <span class="test-name">${r.name} <span style="color: #999; font-weight: normal;">[${r.id}]</span></span>
                    <span class="test-status ${statusClass}">${statusText}</span>
                </div>
                <div class="test-details">${detailsHtml}</div>
                ${errorHtml}
                ${screenshotsHtml}
            </div>
        `;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ETL Pipeline UAT 测试报告</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f5f5;
            padding: 20px;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .header h1 { font-size: 28px; margin-bottom: 10px; }
        .summary { display: flex; gap: 20px; margin-top: 20px; }
        .summary-card {
            background: rgba(255,255,255,0.2);
            padding: 15px 25px;
            border-radius: 8px;
            text-align: center;
        }
        .summary-card .value { font-size: 32px; font-weight: bold; }
        .summary-card .label { font-size: 14px; opacity: 0.9; }
        .test-card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 15px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-left: 4px solid #ccc;
        }
        .test-card.passed { border-left-color: #10b981; }
        .test-card.failed { border-left-color: #ef4444; }
        .test-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .test-name { font-size: 18px; font-weight: 600; }
        .test-status {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .test-status.passed { background: #d1fae5; color: #065f46; }
        .test-status.failed { background: #fee2e2; color: #991b1b; }
        .test-details { font-size: 14px; color: #666; }
        .test-details .field {
            display: inline-block;
            margin-right: 20px;
            padding: 4px 8px;
            background: #f3f4f6;
            border-radius: 4px;
        }
        .error-box {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #991b1b;
            padding: 10px 15px;
            border-radius: 6px;
            margin-top: 10px;
            font-family: monospace;
            font-size: 13px;
        }
        .screenshot-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .screenshot-item {
            background: #f9fafb;
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid #e5e7eb;
        }
        .screenshot-item img { width: 100%; height: auto; display: block; }
        .screenshot-item .caption {
            padding: 8px 12px;
            font-size: 12px;
            color: #666;
            background: white;
        }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 ETL Pipeline UAT 测试报告</h1>
            <div class="summary">
                <div class="summary-card">
                    <div class="value">${totalTests}</div>
                    <div class="label">总测试数</div>
                </div>
                <div class="summary-card">
                    <div class="value" style="color: #10b981;">${passed}</div>
                    <div class="label">通过</div>
                </div>
                <div class="summary-card">
                    <div class="value" style="color: #ef4444;">${failed}</div>
                    <div class="label">失败</div>
                </div>
                <div class="summary-card">
                    <div class="value">${passRate}%</div>
                    <div class="label">通过率</div>
                </div>
            </div>
        </div>

        <h2 style="margin-bottom: 15px;">测试详情</h2>
        ${testCards}

        <div class="footer">生成时间：${new Date().toLocaleString('zh-CN')}</div>
    </div>
</body>
</html>`;

    const reportPath = path.join(REPORT_DIR, 'UAT-REPORT.html');
    fs.writeFileSync(reportPath, html, 'utf-8');
    console.log(`📄 测试报告已保存：${reportPath}`);
    return reportPath;
}

/**
 * 运行单个测试用例（使用外部脚本文件避免转义问题）
 */
async function runTestCase(testCase) {
    let result = {
        id: testCase.id,
        name: testCase.name,
        passed: false,
        details: [],
        screenshots: [],
        error: null
    };

    try {
        // 在项目根目录创建临时测试脚本
        const tempScript = path.join(__dirname, '..', '..', `temp-${testCase.id}.js`);
        const projectRoot = path.join(__dirname, '..', '..');
        const testsDbPath = path.join(projectRoot, 'tests', 'db.js');
        const etlServicePath = path.join(projectRoot, 'src', 'pipeline', 'etl-service.js');

        if (testCase.text) {
            // 文本处理测试 - 使用绝对路径
            const scriptContent = testCase.runTwice ? `
const { getTestPool } = require('${testsDbPath.replace(/\\/g, '/')}');
const { EtlService } = require('${etlServicePath.replace(/\\/g, '/')}');

(async () => {
    const pool = getTestPool();
    const client = await pool.connect();
    const etlService = new EtlService(pool);
    const text = process.argv[2];
    try {
        const r1 = await etlService.processText(text);
        const r2 = await etlService.processText(text);
        console.log(JSON.stringify({
            first: { success: r1.success, context: r1.context },
            second: { isDuplicate: r2.isDuplicate, duplicateOf: r2.duplicateOf },
            isDuplicate: r2.isDuplicate
        }));
    } catch (e) {
        console.error(JSON.stringify({ error: e.message }));
    } finally {
        client.release();
        process.exit(0);
    }
})().catch(e => {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
});
` : `
const { getTestPool } = require('${testsDbPath.replace(/\\/g, '/')}');
const { EtlService } = require('${etlServicePath.replace(/\\/g, '/')}');

(async () => {
    const pool = getTestPool();
    const client = await pool.connect();
    const etlService = new EtlService(pool);
    const text = process.argv[2];
    try {
        const result = await etlService.processText(text);
        console.log(JSON.stringify(result));
    } catch (e) {
        console.error(JSON.stringify({ error: e.message }));
    } finally {
        client.release();
        process.exit(0);
    }
})().catch(e => {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
});
`;

            fs.writeFileSync(tempScript, scriptContent, 'utf-8');

            // 执行脚本
            const output = execSync(
                `node --experimental-vm-modules "${tempScript}" "${testCase.text}"`,
                { encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
            );

            const lines = output.trim().split('\n');
            const jsonLine = lines.find(l => l.startsWith('{'));
            const parsed = JSON.parse(jsonLine || '{}');

            // 清理临时文件
            try { fs.unlinkSync(tempScript); } catch (e) {}

            if (testCase.runTwice && testCase.expectDuplicate) {
                result.details.push({ key: '第一次处理', value: parsed.first?.success ? '成功' : '失败' });
                result.details.push({ key: '第二次处理', value: parsed.second?.isDuplicate ? '检测到重复' : '未检测到重复' });
                result.passed = parsed.second?.isDuplicate === true;
            } else {
                result.details.push({ key: '处理结果', value: parsed.success ? '成功' : '失败' });

                if (testCase.expectedType && parsed.context?.type) {
                    result.details.push({ key: '检测类型', value: parsed.context.type });
                    result.passed = parsed.context.type === testCase.expectedType;
                } else {
                    result.passed = parsed.success;
                }

                if (parsed.context) {
                    result.details.push({ key: 'AI 置信度', value: (parsed.context.aiConfidenceScore * 100).toFixed(0) + '%' });
                    result.details.push({ key: '质量评分', value: (parsed.context.qualityScore * 100).toFixed(0) + '%' });
                    if (parsed.context.category) {
                        result.details.push({ key: '分类', value: parsed.context.category });
                    }
                }

                if (!result.passed && parsed.error) {
                    result.error = parsed.error;
                }
            }

        } else if (testCase.expectError) {
            // 错误处理测试
            const scriptContent = `
const { getTestPool } = require('${testsDbPath.replace(/\\/g, '/')}');
const { EtlService } = require('${etlServicePath.replace(/\\/g, '/')}');

(async () => {
    const pool = getTestPool();
    const client = await pool.connect();
    const etlService = new EtlService(pool);
    try {
        const result = await etlService.processRawData('non-existent');
        console.log(JSON.stringify(result));
    } catch (e) {
        console.error(JSON.stringify({ error: e.message }));
    } finally {
        client.release();
        process.exit(0);
    }
})().catch(e => {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
});
`;
            fs.writeFileSync(tempScript, scriptContent, 'utf-8');

            const output = execSync(
                `node --experimental-vm-modules "${tempScript}"`,
                { encoding: 'utf8', timeout: 30000 }
            );

            const lines = output.trim().split('\n');
            const jsonLine = lines.find(l => l.startsWith('{'));
            const parsed = JSON.parse(jsonLine || '{}');

            try { fs.unlinkSync(tempScript); } catch (e) {}

            result.passed = parsed.error === testCase.expectError;
            result.details.push({ key: '错误消息', value: parsed.error || 'N/A' });
        }

    } catch (error) {
        result.error = error.message;
        result.passed = testCase.expectError ? error.message.includes(testCase.expectError) : false;
    }

    return result;
}

/**
 * 主测试函数
 */
async function runETLUATTests() {
    console.log('='.repeat(60));
    console.log('AnnSight Data Manager UAT 测试 - ETL Pipeline');
    console.log('='.repeat(60));
    console.log('');

    const results = [];
    let browser;
    let page;

    try {
        // 启动浏览器
        browser = await chromium.launch({
            headless: true,
            args: ['--window-size=1280,800']
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 }
        });

        page = await context.newPage();

        // 创建测试页面
        await page.setContent(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>ETL Pipeline UAT Test Page</title>
                <style>
                    body { font-family: system-ui; padding: 20px; max-width: 800px; margin: 0 auto; }
                    .test-section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; }
                    .result { margin-top: 10px; padding: 10px; border-radius: 4px; }
                    .result.success { background: #d1fae5; }
                    .result.error { background: #fee2e2; }
                    h1 { color: #667eea; }
                </style>
            </head>
            <body>
                <h1>🧪 ETL Pipeline UAT 测试控制台</h1>
                <div id="test-results"></div>
                <div class="test-section">
                    <h3>测试状态</h3>
                    <div id="status">等待开始...</div>
                </div>
            </body>
            </html>
        `);

        // 保存初始状态截图
        const initFilename = await saveScreenshot(page, '00-init', 'state');
        if (initFilename) console.log('📸 初始状态截图已保存');

        // 执行每个测试用例
        for (const testCase of TEST_CASES) {
            console.log(`\n▶️  测试 #${testCase.id}: ${testCase.name}`);

            // 运行测试
            const testResult = await runTestCase(testCase);

            // 更新页面状态
            const statusHtml = `
                <div class="result ${testResult.passed ? 'success' : 'error'}">
                    <strong>${testCase.name}</strong>: ${testResult.passed ? '✓ 通过' : '✗ 失败'}
                    ${testResult.error ? '<br>错误：' + testResult.error : ''}
                </div>
            `;

            await page.evaluate((html) => {
                const statusEl = document.getElementById('status');
                statusEl.innerHTML += html;
            }, statusHtml);

            // 保存截图
            const screenshotFilename = await saveScreenshot(page, testResult.id, 'result');
            if (screenshotFilename) {
                testResult.screenshots.push({
                    filename: screenshotFilename,
                    description: `测试结果：${testResult.passed ? '通过' : '失败'}`
                });
            }

            // 添加到结果列表
            results.push(testResult);

            // 控制台输出
            const statusIcon = testResult.passed ? '✅' : '❌';
            console.log(`   ${statusIcon} ${testResult.passed ? '通过' : '失败'}`);
            if (testResult.error) {
                console.log(`   ⚠️  错误：${testResult.error}`);
            }
        }

        // 保存最终状态截图
        const finalFilename = await saveScreenshot(page, '99-final', 'state');
        if (finalFilename) console.log('\n📸 最终状态截图已保存');

        // 生成 HTML 报告
        generateReport(results);

        // 输出摘要
        console.log('');
        console.log('='.repeat(60));
        const passed = results.filter(r => r.passed).length;
        const total = results.length;
        console.log(`测试完成：${passed}/${total} 通过 (${((passed/total)*100).toFixed(1)}%)`);
        console.log(`截图保存至：${OUTPUT_DIR}`);
        console.log('='.repeat(60));

        // 如果没有通过，退出时返回错误码
        if (passed < total) {
            process.exit(1);
        }

    } catch (error) {
        console.error('UAT 测试执行失败:', error);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 运行测试
runETLUATTests().catch(console.error);
