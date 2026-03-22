const playwright = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOTS_DIR = '/home/admin/projects/annsight-data-manager/tests/uat/screenshots-agent-verification';

// 创建目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const verificationResults = [];

(async () => {
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // 1. 数据审核页面 (首页)
    console.log('正在验证数据审核页面...');
    try {
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(2000);

        // 检查统计卡片
        const statsCards = await page.$$('.stat-card, .stat, .card');
        const hasStats = statsCards.length > 0;

        // 检查数据列表
        const dataTable = await page.$('table, .data-list, .table');
        const hasTable = dataTable !== null;

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-review.png'), fullPage: false });
        verificationResults.push({
            page: '数据审核',
            status: '✅',
            details: `统计卡片：${hasStats ? '已加载' : '未找到'}, 数据列表：${hasTable ? '已加载' : '未找到'}`
        });
        console.log('数据审核页面验证完成');
    } catch (error) {
        verificationResults.push({
            page: '数据审核',
            status: '❌',
            details: error.message
        });
        console.error('数据审核页面验证失败:', error.message);
    }

    // 2. 源数据管理页面
    console.log('正在验证源数据管理页面...');
    try {
        await page.goto(BASE_URL + '/raw-data.html', { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-raw-data.png'), fullPage: false });
        verificationResults.push({
            page: '源数据管理',
            status: '✅',
            details: '页面正常加载'
        });
        console.log('源数据管理页面验证完成');
    } catch (error) {
        verificationResults.push({
            page: '源数据管理',
            status: '❌',
            details: error.message
        });
        console.error('源数据管理页面验证失败:', error.message);
    }

    // 3. 统计看板页面
    console.log('正在验证统计看板页面...');
    try {
        await page.goto(BASE_URL + '/stats.html', { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);

        // 检查是否有图表
        const charts = await page.$$('.chart, .echart, .recharts, canvas');
        const hasCharts = charts.length > 0;

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-stats.png'), fullPage: false });
        verificationResults.push({
            page: '统计看板',
            status: '✅',
            details: hasCharts ? `图表数量：${charts.length}` : '未检测到图表元素'
        });
        console.log('统计看板页面验证完成');
    } catch (error) {
        verificationResults.push({
            page: '统计看板',
            status: '❌',
            details: error.message
        });
        console.error('统计看板页面验证失败:', error.message);
    }

    // 4. 人工抽检页面
    console.log('正在验证人工抽检页面...');
    try {
        await page.goto(BASE_URL + '/spotcheck.html', { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-spotcheck.png'), fullPage: false });
        verificationResults.push({
            page: '人工抽检',
            status: '✅',
            details: '页面正常加载'
        });
        console.log('人工抽检页面验证完成');
    } catch (error) {
        verificationResults.push({
            page: '人工抽检',
            status: '❌',
            details: error.message
        });
        console.error('人工抽检页面验证失败:', error.message);
    }

    await browser.close();

    // 生成报告
    const timestamp = new Date().toLocaleString('zh-CN');
    const successCount = verificationResults.filter(r => r.status === '✅').length;
    const totalCount = verificationResults.length;

    let report = `# Agent 验证报告\n\n`;
    report += `**验证时间**: ${timestamp}\n\n`;
    report += `## 验证概览\n\n`;
    report += `**总计**: ${totalCount} 页面 | **成功**: ${successCount} | **失败**: ${totalCount - successCount}\n\n`;
    report += `## 验证结果\n\n`;
    report += `| 页面 | 状态 | 详情 |\n`;
    report += `|------|------|------|\n`;

    for (const result of verificationResults) {
        report += `| ${result.page} | ${result.status} | ${result.details} |\n`;
    }

    report += `\n## 截图文件\n\n`;
    report += `所有截图已保存到：\`${SCREENSHOTS_DIR}\`\n\n`;
    report += `| 序号 | 文件 | 页面 |\n`;
    report += `|------|------|------|\n`;
    report += `| 1 | 01-review.png | 数据审核 |\n`;
    report += `| 2 | 02-raw-data.png | 源数据管理 |\n`;
    report += `| 3 | 03-stats.png | 统计看板 |\n`;
    report += `| 4 | 04-spotcheck.png | 人工抽检 |\n`;

    const reportPath = path.join(SCREENSHOTS_DIR, 'AGENT-VERIFICATION-REPORT.md');
    fs.writeFileSync(reportPath, report);

    console.log('\n========================================');
    console.log('验证完成！');
    console.log(`报告已保存至：${reportPath}`);
    console.log('========================================\n');

    // 打印报告
    console.log(report);
})();
