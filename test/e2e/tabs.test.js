const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BUILT_FILE = 'file:///C:/Users/Admin/Desktop/pred/web/dist/index.html';
const TABS = ['dashboard', 'prediction', 'analysis', 'compare', 'explore', 'trackmap'];

async function runTests() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const results = [];

  try {
    // Test 1: Navigate to the built file
    console.log('\n--- Test 1: Navigate to built file ---');
    await page.goto(BUILT_FILE, { waitUntil: 'networkidle' });
    results.push({ test: 'Navigate to built file', status: 'PASS' });
    console.log('PASS: Successfully navigated to built file');
  } catch (error) {
    results.push({ test: 'Navigate to built file', status: 'FAIL', error: error.message });
    console.log('FAIL: Could not navigate to built file -', error.message);
    await browser.close();
    return results;
  }

  // Test 2: Verify all 6 tab buttons exist
  console.log('\n--- Test 2: Verify all tab buttons exist ---');
  try {
    for (const tab of TABS) {
      const selector = `button[data-tab="${tab}"]`;
      const element = await page.$(selector);
      if (element) {
        results.push({ test: `Tab button "${tab}" exists`, status: 'PASS' });
        console.log(`PASS: Tab button "${tab}" exists`);
      } else {
        results.push({ test: `Tab button "${tab}" exists`, status: 'FAIL' });
        console.log(`FAIL: Tab button "${tab}" not found`);
      }
    }
  } catch (error) {
    results.push({ test: 'Verify tab buttons', status: 'FAIL', error: error.message });
    console.log('FAIL: Error verifying tab buttons -', error.message);
  }

  // Test 3: Click each tab and verify corresponding section becomes visible
  console.log('\n--- Test 3: Click each tab and verify section visibility ---');
  for (const tab of TABS) {
    try {
      const buttonSelector = `button[data-tab="${tab}"]`;
      const sectionSelector = `#tab-${tab}`;

      // Click the tab button
      await page.click(buttonSelector);
      await page.waitForTimeout(300); // Wait for any animations

      // Check if the section is visible
      const isVisible = await page.isVisible(sectionSelector);

      if (isVisible) {
        results.push({ test: `Click tab "${tab}" and verify visibility`, status: 'PASS' });
        console.log(`PASS: Tab "${tab}" clicked and section #tab-${tab} is visible`);
      } else {
        results.push({ test: `Click tab "${tab}" and verify visibility`, status: 'FAIL' });
        console.log(`FAIL: Tab "${tab}" clicked but section #tab-${tab} is not visible`);
      }
    } catch (error) {
      results.push({
        test: `Click tab "${tab}" and verify visibility`,
        status: 'FAIL',
        error: error.message,
      });
      console.log(`FAIL: Error clicking tab "${tab}" -`, error.message);
    }
  }

  // Test 4: Verify ARIA attributes update correctly (aria-selected)
  console.log('\n--- Test 4: Verify ARIA attributes (aria-selected) ---');
  for (const tab of TABS) {
    try {
      const buttonSelector = `button[data-tab="${tab}"]`;

      // Click the tab button
      await page.click(buttonSelector);
      await page.waitForTimeout(300); // Wait for any animations

      // Check aria-selected attribute
      const ariaSelected = await page.getAttribute(buttonSelector, 'aria-selected');

      if (ariaSelected === 'true') {
        results.push({
          test: `ARIA aria-selected for "${tab}"`,
          status: 'PASS',
        });
        console.log(`PASS: Tab "${tab}" has aria-selected="true"`);
      } else {
        results.push({
          test: `ARIA aria-selected for "${tab}"`,
          status: 'FAIL',
          details: `aria-selected is "${ariaSelected}"`,
        });
        console.log(`FAIL: Tab "${tab}" aria-selected is "${ariaSelected}" (expected "true")`);
      }

      // Verify other tabs have aria-selected="false"
      for (const otherTab of TABS) {
        if (otherTab !== tab) {
          const otherButtonSelector = `button[data-tab="${otherTab}"]`;
          const otherAriaSelected = await page.getAttribute(otherButtonSelector, 'aria-selected');

          if (otherAriaSelected === 'false') {
            results.push({
              test: `ARIA aria-selected for inactive tab "${otherTab}"`,
              status: 'PASS',
            });
          } else {
            results.push({
              test: `ARIA aria-selected for inactive tab "${otherTab}"`,
              status: 'FAIL',
              details: `aria-selected is "${otherAriaSelected}"`,
            });
            console.log(
              `FAIL: Inactive tab "${otherTab}" aria-selected is "${otherAriaSelected}" (expected "false")`
            );
          }
        }
      }
    } catch (error) {
      results.push({
        test: `ARIA verification for "${tab}"`,
        status: 'FAIL',
        error: error.message,
      });
      console.log(`FAIL: ARIA verification error for "${tab}" -`, error.message);
    }
  }

  // Test 5: Test keyboard shortcuts Alt+1 through Alt+6
  console.log('\n--- Test 5: Test keyboard shortcuts (Alt+1 through Alt+6) ---');
  const keyboardShortcuts = [
    { key: 'Alt+1', tab: 'dashboard' },
    { key: 'Alt+2', tab: 'prediction' },
    { key: 'Alt+3', tab: 'analysis' },
    { key: 'Alt+4', tab: 'compare' },
    { key: 'Alt+5', tab: 'explore' },
    { key: 'Alt+6', tab: 'trackmap' },
  ];

  for (const shortcut of keyboardShortcuts) {
    try {
      // Press the keyboard shortcut
      await page.keyboard.press(shortcut.key);
      await page.waitForTimeout(300); // Wait for any animations

      // Check if the corresponding section is visible
      const sectionSelector = `#tab-${shortcut.tab}`;
      const isVisible = await page.isVisible(sectionSelector);

      if (isVisible) {
        results.push({
          test: `Keyboard shortcut ${shortcut.key} activates "${shortcut.tab}"`,
          status: 'PASS',
        });
        console.log(`PASS: Keyboard shortcut ${shortcut.key} activated tab "${shortcut.tab}"`);
      } else {
        results.push({
          test: `Keyboard shortcut ${shortcut.key} activates "${shortcut.tab}"`,
          status: 'FAIL',
        });
        console.log(`FAIL: Keyboard shortcut ${shortcut.key} did not activate tab "${shortcut.tab}"`);
      }

      // Also verify aria-selected on the button
      const buttonSelector = `button[data-tab="${shortcut.tab}"]`;
      const ariaSelected = await page.getAttribute(buttonSelector, 'aria-selected');

      if (ariaSelected === 'true') {
        results.push({
          test: `Keyboard shortcut ${shortcut.key} sets aria-selected correctly`,
          status: 'PASS',
        });
      } else {
        results.push({
          test: `Keyboard shortcut ${shortcut.key} sets aria-selected correctly`,
          status: 'FAIL',
          details: `aria-selected is "${ariaSelected}"`,
        });
        console.log(
          `FAIL: After ${shortcut.key}, aria-selected is "${ariaSelected}" (expected "true")`
        );
      }
    } catch (error) {
      results.push({
        test: `Keyboard shortcut ${shortcut.key}`,
        status: 'FAIL',
        error: error.message,
      });
      console.log(`FAIL: Error testing keyboard shortcut ${shortcut.key} -`, error.message);
    }
  }

  await browser.close();

  return results;
}

// Run tests and print summary
(async () => {
  console.log('========== E2E Tab Navigation Tests ==========\n');

  const results = await runTests();

  // Print summary
  console.log('\n========== Test Summary ==========');
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;

  console.log(`Total Tests: ${results.length}`);
  console.log(`PASS: ${passCount}`);
  console.log(`FAIL: ${failCount}`);
  console.log(`Success Rate: ${((passCount / results.length) * 100).toFixed(2)}%`);

  // Print detailed results
  console.log('\n========== Detailed Results ==========');
  results.forEach((result) => {
    const statusIcon = result.status === 'PASS' ? '✓' : '✗';
    console.log(`${statusIcon} ${result.test}: ${result.status}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    if (result.details) {
      console.log(`  Details: ${result.details}`);
    }
  });

  process.exit(failCount > 0 ? 1 : 0);
})();
