const { chromium } = require('playwright');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  PASS: ${name}`); }
  catch(e) { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

(async () => {
  console.log('=== TrackMap Tab E2E Tests ===');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  const url = 'file:///' + process.cwd().replace(/\\/g, '/') + '/web/dist/index.html';
  await page.goto(url);
  await page.waitForTimeout(2000);

  // Navigate to trackmap tab
  await page.click('.tab-btn[data-tab="trackmap"]');
  await page.waitForTimeout(1000);

  await test('trackmap tab visible', async () => {
    const visible = await page.$eval('#tab-trackmap', el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none';
    });
    if (!visible) throw new Error('trackmap tab not visible');
  });

  await test('track map container exists', async () => {
    const el = await page.$('#track-map-container');
    if (!el) throw new Error('track map container not found');
  });

  await test('SVG rendered in track map', async () => {
    const svg = await page.$('#track-map-container svg');
    if (!svg) throw new Error('no SVG in track map container');
  });

  await test('track segments rendered', async () => {
    const segments = await page.$$('#track-map-container .track-segment');
    if (segments.length === 0) throw new Error('no track segments found');
  });

  await test('sensor markers rendered', async () => {
    const markers = await page.$$('#track-map-container .sensor-marker');
    if (markers.length === 0) throw new Error('no sensor markers found');
  });

  // Test dashboard track map as well
  await page.click('.tab-btn[data-tab="dashboard"]');
  await page.waitForTimeout(1000);

  await test('dashboard track map SVG exists', async () => {
    const svg = await page.$('#dash-track-container svg');
    if (!svg) throw new Error('no SVG in dashboard track container');
  });

  await page.screenshot({ path: 'test/e2e/trackmap_result.png' });

  await browser.close();
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
