const { chromium } = require('playwright');
const path = require('path');

(async () => {
    console.log('🚀 Starting AnnSight file upload test...');

    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-gpu', '--no-sandbox']
    });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    const screenshotDir = '/home/admin/projects/annsight-data-manager/tests/uat/screenshots-file-upload';
    const testFile = '/tmp/test-upload.txt';

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

        // Step 4: Fill batch ID first
        console.log('📍 Step 4: Filling batch ID');
        const batchIdInput = page.locator('#file-upload-batch-id');
        await batchIdInput.fill('test-batch-' + Date.now());
        await page.waitForTimeout(300);

        // Upload test file
        console.log('📍 Step 5: Uploading test file:', testFile);
        const fileInput = page.locator('#file-input');
        await fileInput.setInputFiles(testFile);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(screenshotDir, '04-file-selected.png') });
        console.log('✅ File selected');

        // Click confirm upload button
        console.log('📍 Step 6: Clicking upload confirm button');
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

        if (isToastVisible) {
            toastText = await toast.textContent();
            console.log('Toast message:', toastText);
            isSuccess = toastText.includes('成功') || toastText.includes('完成');
        }

        // Final screenshot
        await page.screenshot({ path: path.join(screenshotDir, '06-final-result.png') });
        console.log('✅ Final screenshot saved');

        // Get page title
        const pageTitle = await page.title();

        console.log('\n📊 Test Results:');
        console.log('   Page Title:', pageTitle);
        console.log('   Toast Visible:', isToastVisible);
        console.log('   Toast Message:', toastText);
        console.log('   Is Success:', isSuccess);
        console.log('   Screenshots saved to:', screenshotDir);

        if (isSuccess) {
            console.log('\n✅ FILE UPLOAD TEST PASSED');
        } else if (toastText) {
            console.log('\n⚠️ FILE UPLOAD TEST - Toast shown:', toastText);
        } else {
            console.log('\n⚠️ FILE UPLOAD TEST - Check screenshots for verification');
        }

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        await page.screenshot({ path: path.join(screenshotDir, 'error-state.png') });
        console.log('Error screenshot saved');
    } finally {
        await browser.close();
        console.log('\n🏁 Test completed');
    }
})();
