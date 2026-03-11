const { chromium } = require('playwright');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  PASS: ${name}`); }
  catch(e) { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

(async () => {
  console.log('=== Prediction Tab E2E Tests ===');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  const url = 'file:///' + process.cwd().replace(/\\/g, '/') + '/web/dist/index.html';
  await page.goto(url);
  await page.waitForTimeout(2000);

  // Navigate to prediction tab
  await page.click('.tab-btn[data-tab="prediction"]');
  await page.waitForTimeout(500);

  await test('prediction tab visible', async () => {
    const visible = await page.$eval('#tab-prediction', el => !el.classList.contains('hidden') && el.style.display !== 'none');
    if (!visible) throw new Error('prediction tab not visible');
  });

  await test('gender filter exists', async () => {
    const el = await page.$('#pred-gender-filter');
    if (!el) throw new Error('gender filter not found');
  });

  await test('model select exists', async () => {
    const el = await page.$('#pred-model-select');
    if (!el) throw new Error('model select not found');
  });

  await test('run button exists', async () => {
    const el = await page.$('#pred-run-btn');
    if (!el) throw new Error('run button not found');
  });

  // Select gender and run prediction
  await page.selectOption('#pred-gender-filter', 'M');
  await page.waitForTimeout(300);

  // Fill start time
  const startInput = await page.$('#pred-start-time');
  if (startInput) {
    await startInput.fill('4.85');
  }

  await test('click predict without start time shows error or result', async () => {
    await page.click('#pred-run-btn');
    await page.waitForTimeout(1000);
    const result = await page.$('#pred-result');
    const html = result ? await result.innerHTML() : '';
    if (!html || html.length < 10) throw new Error('no result displayed');
  });

  // Test model switching
  const modelSelect = await page.$('#pred-model-select');
  if (modelSelect) {
    const options = await page.$$eval('#pred-model-select option', opts => opts.map(o => o.value));

    await test('model select has options', async () => {
      if (options.length < 2) throw new Error('too few model options: ' + options.length);
    });

    // Test XGBoost pre-start if available
    if (options.includes('xgb_pre')) {
      await test('XGBoost pre-start model selectable', async () => {
        await page.selectOption('#pred-model-select', 'xgb_pre');
        await page.waitForTimeout(300);
        const panel = await page.$('#pred-xgb-pre-inputs');
        if (panel) {
          const hidden = await panel.evaluate(el => el.classList.contains('hidden'));
          if (hidden) throw new Error('xgb_pre inputs still hidden');
        }
      });
    }
  }

  await page.screenshot({ path: 'test/e2e/prediction_result.png' });

  await browser.close();
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
