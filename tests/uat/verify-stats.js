const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const screenshotPath = '/home/admin/projects/annsight-data-manager/tests/uat/screenshots-agent-verification/03-stats-fixed.png';

  // Ensure screenshot directory exists
  const screenshotDir = path.dirname(screenshotPath);
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    console.log(`Created screenshot directory: ${screenshotDir}`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Set viewport size
  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('Navigating to http://localhost:3000/stats.html...');
  await page.goto('http://localhost:3000/stats.html', { waitUntil: 'networkidle' });

  console.log('Waiting 2 seconds for page to fully load...');
  await page.waitForTimeout(2000);

  // Take screenshot
  console.log(`Taking screenshot: ${screenshotPath}`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Check batch statistics
  console.log('\n--- Checking batch statistics ---');

  // Try to find batch statistics section
  const batchStats = await page.$$eval('.batch-stats-card, .stats-card, [class*="batch"], [class*="stats"]', cards => {
    return cards.map(card => ({
      class: card.className,
      text: card.textContent?.trim().substring(0, 200)
    }));
  });

  console.log('Found stats cards:', batchStats.length);
  batchStats.forEach((card, i) => {
    console.log(`  Card ${i + 1}: ${card.text}`);
  });

  // Check for batch count display
  const batchCount = await page.$$eval('.batch-item, .batch-row, tr', rows => rows.length);
  console.log(`Found ${batchCount} batch rows/items`);

  // Get all visible text on page
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('\n--- Page content preview ---');
  console.log(pageText.substring(0, 1000));

  // Check if data is displayed
  const hasData = batchCount > 0 || batchStats.length > 0;
  console.log('\n--- Verification Result ---');
  if (hasData) {
    console.log('✅ Batch statistics section is displaying data');
    console.log(`   Found ${batchCount} batch items / ${batchStats.length} stats cards`);
  } else {
    console.log('❌ Batch statistics section appears empty');
  }

  await browser.close();
  console.log(`\nScreenshot saved to: ${screenshotPath}`);
})();
