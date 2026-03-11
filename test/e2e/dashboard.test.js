const { chromium } = require('playwright');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  PASS: ${name}`); }
  catch(e) { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

(async () => {
  console.log('=== Dashboard E2E Tests ===');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  // Inject mock data before page scripts run
  await page.addInitScript(() => {
    // Override fetch to return mock data
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.includes('/api/records')) {
        const mockData = [];
        const names = ['여 찬혁', '정 승기', '김 지수', '신 연수', '홍 수정'];
        const genders = ['M', 'M', 'M', 'M', 'W'];
        for (let i = 0; i < names.length; i++) {
          for (let r = 0; r < 5; r++) {
            mockData.push({
              name: names[i], gender: genders[i], nat: 'KOR', session: 'Training',
              date: '25.01.26', status: 'OK', run: r + 1,
              start_time: (4.8 + Math.random() * 0.3).toFixed(3),
              int1: (14.5 + Math.random() * 0.5).toFixed(3),
              int2: (25.3 + Math.random() * 0.5).toFixed(3),
              int3: (37.1 + Math.random() * 0.5).toFixed(3),
              int4: (44.2 + Math.random() * 0.5).toFixed(3),
              finish: (51.0 + Math.random() * 2).toFixed(3),
              speed: (120 + Math.random() * 10).toFixed(1),
              format: 'TRAINING'
            });
          }
        }
        return Promise.resolve(new Response(JSON.stringify(mockData), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return origFetch.call(this, url, opts);
    };
  });

  const url = 'file:///' + process.cwd().replace(/\\/g, '/') + '/web/dist/index.html';
  await page.goto(url);
  await page.waitForTimeout(3000);

  await test('dashboard tab is active by default', async () => {
    const active = await page.$eval('#tab-dashboard', el => el.classList.contains('active'));
    if (!active) throw new Error('dashboard section not active');
  });

  await test('dashboard tab button is active', async () => {
    const active = await page.$eval('.tab-btn[data-tab="dashboard"]', el => el.classList.contains('active'));
    if (!active) throw new Error('dashboard button not active');
  });

  await test('3-panel layout elements exist', async () => {
    const ids = ['dash-gender', 'dash-player', 'dash-predict-btn', 'dash-track-container', 'dash-prediction-result', 'dash-coaching-tips'];
    for (const id of ids) {
      const el = await page.$(`#${id}`);
      if (!el) throw new Error(`#${id} not found`);
    }
  });

  await test('track map SVG rendered', async () => {
    const svg = await page.$('#dash-track-container svg');
    if (!svg) throw new Error('no SVG in dash-track-container');
  });

  await test('select gender M', async () => {
    await page.selectOption('#dash-gender', 'M');
    await page.waitForTimeout(500);
    const val = await page.$eval('#dash-gender', el => el.value);
    if (val !== 'M') throw new Error('gender not set to M, got ' + val);
  });

  await test('player dropdown populated after gender select', async () => {
    const count = await page.$$eval('#dash-player option', opts => opts.length);
    if (count <= 1) throw new Error('player options not populated: ' + count);
  });

  await test('fill environment inputs', async () => {
    await page.fill('#dash-airtemp', '-5');
    await page.fill('#dash-humidity', '60');
    await page.fill('#dash-pressure', '935');
    await page.waitForTimeout(500);
    // Check calculated values appeared
    const calc = await page.$eval('#dash-calc-values', el => el.textContent);
    if (!calc.includes('kg/m')) throw new Error('calc values not showing density');
  });

  await test('fill target start and run prediction', async () => {
    await page.fill('#dash-target-start', '4.85');
    await page.click('#dash-predict-btn');
    await page.waitForTimeout(1000);
    const result = await page.$eval('#dash-prediction-result', el => el.textContent);
    if (!result || result.length < 5) throw new Error('no prediction result');
    if (result.includes('성별을 선택')) throw new Error('still showing gender prompt');
  });

  await test('coaching tips displayed', async () => {
    const tips = await page.$eval('#dash-coaching-tips', el => el.textContent);
    if (!tips || tips.includes('대기 중')) throw new Error('tips not updated');
  });

  await browser.close();
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
