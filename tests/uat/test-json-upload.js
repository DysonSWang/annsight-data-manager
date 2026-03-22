const { chromium } = require('playwright');
const path = require('path');

(async () => {
    console.log('🚀 Starting AnnSight JSON file upload test...');

    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-gpu', '--no-sandbox']
    });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    const screenshotDir = '/home/admin/projects/annsight-data-manager/tests/uat/screenshots-json-upload';
    const testFile = '/home/admin/projects/annsight-data-manager/test-data.json';

    try {
        // Step 1: Visit the raw-data page
        console.log('📍 Step 1: Visiting http://localhost:3000/raw-data.html');
        await page.goto('http://localhost:3000/raw-data.html', { waitUntil: 'networkidle' });
        await page.screenshot({ path: path.join(screenshotDir, '01-page-loaded.png') });
        console.log('✅ Page loaded');

        // Step 2: Click the "批量上传" button
        console.log('📍 Step 2: Clicking "批量上传" button');
        const batchUploadBtn = page.locator('button[onclick="showUploadModal()"]');
        await batchUploadBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(screenshotDir, '02-upload-modal.png') });
        console.log('✅ Upload modal opened');

        // Step 3: Switch to "文件上传" tab
        console.log('📍 Step 3: Switching to "文件上传" tab');
        const fileUploadTab = page.locator('#tab-file');
        await fileUploadTab.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(screenshotDir, '03-file-upload-tab.png') });
        console.log('✅ Switched to file upload tab');

        // Step 4: Select source "知乎"
        console.log('📍 Step 4: Selecting source "知乎"');
        const sourceSelect = page.locator('#file-upload-source');
        await sourceSelect.selectOption('zhihu');
        await page.waitForTimeout(300);

        // Step 5: Fill batch ID
        console.log('📍 Step 5: Filling batch ID: json-test-2026-03-21');
        const batchIdInput = page.locator('#file-upload-batch-id');
        await batchIdInput.fill('json-test-2026-03-21');
        await page.waitForTimeout(300);

        // Step 6: Upload JSON file
        console.log('📍 Step 6: Uploading JSON file:', testFile);
        const fileInput = page.locator('#file-input');
        await fileInput.setInputFiles(testFile);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(screenshotDir, '04-file-selected.png') });
        console.log('✅ File selected');

        // Check file preview
        const filePreview = page.locator('#file-preview');
        const isPreviewVisible = await filePreview.isVisible();
        console.log('✅ File preview visible:', isPreviewVisible);

        // Step 7: Click confirm upload button
        console.log('📍 Step 7: Clicking upload confirm button');
        const confirmBtn = page.locator('#upload-confirm-btn');
        await confirmBtn.click();
        await page.waitForTimeout(3000);

        await page.screenshot({ path: path.join(screenshotDir, '05-after-upload.png') });
        console.log('✅ Upload button clicked');

        // Check for success toast
        const toast = page.locator('#toast');
        const isToastVisible = await toast.isVisible();
        let toastText = '';
        let isSuccess = false;
        let successCount = 0;
        let totalCount = 0;

        if (isToastVisible) {
            toastText = await toast.textContent();
            console.log('Toast message:', toastText);

            // Extract success count from toast message
            const match = toastText.match(/成功 (\d+) \/ (\d+)/);
            if (match) {
                successCount = parseInt(match[1]);
                totalCount = parseInt(match[2]);
                isSuccess = true;
            } else {
                isSuccess = toastText.includes('成功') || toastText.includes('完成');
            }
        }

        // Refresh to see uploaded data
        await page.waitForTimeout(1000);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(screenshotDir, '06-after-refresh.png') });
        console.log('✅ Page refreshed');

        // Check table for uploaded data
        const tableBody = page.locator('#table-body');
        const tableText = await tableBody.textContent();
        const hasJsonBatch = tableText.includes('json-test-2026-03-21');
        console.log('✅ JSON batch visible in table:', hasJsonBatch);

        // Final screenshot
        await page.screenshot({ path: path.join(screenshotDir, '07-final-result.png') });
        console.log('✅ Final screenshot saved');

        // Get page title
        const pageTitle = await page.title();

        console.log('\n📊 Test Results:');
        console.log('   Page Title:', pageTitle);
        console.log('   Toast Visible:', isToastVisible);
        console.log('   Toast Message:', toastText);
        console.log('   Success Count:', successCount);
        console.log('   Total Count:', totalCount);
        console.log('   Is Success:', isSuccess);
        console.log('   JSON batch visible in table:', hasJsonBatch);
        console.log('   Screenshots saved to:', screenshotDir);

        if (isSuccess && hasJsonBatch) {
            console.log('\n✅ JSON FILE UPLOAD TEST PASSED');
            console.log(`   Successfully uploaded ${successCount} / ${totalCount} records`);
        } else if (isSuccess) {
            console.log('\n✅ JSON FILE UPLOAD PARTIAL SUCCESS');
            console.log(`   Upload completed: ${successCount} / ${totalCount} records`);
            console.log('   ⚠️ But data not visible in table - may need ETL processing');
        } else if (toastText) {
            console.log('\n⚠️ JSON FILE UPLOAD TEST - Toast shown:', toastText);
        } else {
            console.log('\n❌ JSON FILE UPLOAD TEST FAILED - Check screenshots for verification');
        }

        // Generate HTML report
        const reportContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>JSON Upload UAT Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2rem auto; padding: 1rem; background: #f5f5f5; }
        .card { background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        h1 { color: #111827; }
        .status { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 600; }
        .status.pass { background: #d1fae5; color: #065f46; }
        .status.warn { background: #fef3c7; color: #92400e; }
        .status.fail { background: #fee2e2; color: #991b1b; }
        .result-item { padding: 0.75rem; border-bottom: 1px solid #e5e7eb; }
        .result-item:last-child { border-bottom: none; }
        .label { font-weight: 600; color: #6b7280; }
        .value { color: #111827; }
        .screenshots { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
        .screenshot { border-radius: 6px; overflow: hidden; border: 1px solid #e5e7eb; }
        .screenshot img { width: 100%; height: auto; display: block; }
        .screenshot-caption { padding: 0.5rem; background: #f9fafb; font-size: 0.875rem; text-align: center; }
    </style>
</head>
<body>
    <h1>📊 JSON File Upload UAT Report</h1>

    <div class="card">
        <h2>Test Summary</h2>
        <div class="result-item">
            <span class="label">Status: </span>
            <span class="status ${isSuccess && hasJsonBatch ? 'pass' : (isSuccess ? 'warn' : 'fail')}">
                ${isSuccess && hasJsonBatch ? 'PASSED' : (isSuccess ? 'PARTIAL SUCCESS' : 'FAILED')}
            </span>
        </div>
        <div class="result-item">
            <span class="label">Page Title: </span>
            <span class="value">${pageTitle}</span>
        </div>
        <div class="result-item">
            <span class="label">Toast Message: </span>
            <span class="value">${toastText || 'N/A'}</span>
        </div>
        <div class="result-item">
            <span class="label">Success Count: </span>
            <span class="value">${successCount} / ${totalCount}</span>
        </div>
        <div class="result-item">
            <span class="label">Data Visible in Table: </span>
            <span class="value">${hasJsonBatch ? 'Yes' : 'No'}</span>
        </div>
        <div class="result-item">
            <span class="label">Test Time: </span>
            <span class="value">${new Date().toLocaleString('zh-CN')}</span>
        </div>
    </div>

    <div class="card">
        <h2>Screenshots</h2>
        <div class="screenshots">
            <div class="screenshot">
                <img src="01-page-loaded.png" alt="Page Loaded">
                <div class="screenshot-caption">1. Page Loaded</div>
            </div>
            <div class="screenshot">
                <img src="02-upload-modal.png" alt="Upload Modal">
                <div class="screenshot-caption">2. Upload Modal</div>
            </div>
            <div class="screenshot">
                <img src="03-file-upload-tab.png" alt="File Upload Tab">
                <div class="screenshot-caption">3. File Upload Tab</div>
            </div>
            <div class="screenshot">
                <img src="04-file-selected.png" alt="File Selected">
                <div class="screenshot-caption">4. File Selected</div>
            </div>
            <div class="screenshot">
                <img src="05-after-upload.png" alt="After Upload">
                <div class="screenshot-caption">5. After Upload</div>
            </div>
            <div class="screenshot">
                <img src="06-after-refresh.png" alt="After Refresh">
                <div class="screenshot-caption">6. After Refresh</div>
            </div>
            <div class="screenshot">
                <img src="07-final-result.png" alt="Final Result">
                <div class="screenshot-caption">7. Final Result</div>
            </div>
        </div>
    </div>
</body>
</html>
`;
        const fs = require('fs');
        fs.writeFileSync(path.join(screenshotDir, 'UAT-REPORT.html'), reportContent);
        console.log('✅ HTML report generated:', path.join(screenshotDir, 'UAT-REPORT.html'));

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        await page.screenshot({ path: path.join(screenshotDir, 'error-state.png') });
        console.log('Error screenshot saved');

        // Generate error report
        const fs = require('fs');
        const reportContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>JSON Upload UAT Report - ERROR</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2rem auto; padding: 1rem; background: #f5f5f5; }
        .card { background: white; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .error { color: #dc2626; background: #fee2e2; padding: 1rem; border-radius: 6px; font-family: monospace; }
        h1 { color: #111827; }
    </style>
</head>
<body>
    <h1>❌ JSON File Upload UAT - ERROR</h1>
    <div class="card">
        <h2>Error Details</h2>
        <div class="error">${error.message.replace(/</g, '&lt;')}</div>
        <p style="margin-top: 1rem; color: #6b7280;">Test Time: ${new Date().toLocaleString('zh-CN')}</p>
    </div>
</body>
</html>
`;
        fs.writeFileSync(path.join(screenshotDir, 'UAT-REPORT.html'), reportContent);
    } finally {
        await browser.close();
        console.log('\n🏁 Test completed');
    }
})();
