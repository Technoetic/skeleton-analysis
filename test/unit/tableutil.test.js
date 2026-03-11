const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Load TableRenderer source
const src = fs.readFileSync(path.join(__dirname, '../../web/src/js/TableRenderer.js'), 'utf-8');

// Mock browser globals
global.document = { getElementById: () => null };
global.UIController = { fmtDate: d => d };
global.Tabulator = undefined;

const vm = require('vm');
vm.runInThisContext(src);

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch(e) { failed++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

console.log('=== TableRenderer Unit Tests ===');

// _esc tests
test('_esc: null returns dash', () => {
  assert.strictEqual(_esc(null), '-');
});
test('_esc: undefined returns dash', () => {
  assert.strictEqual(_esc(undefined), '-');
});
test('_esc: normal string passthrough', () => {
  assert.strictEqual(_esc('hello'), 'hello');
});
test('_esc: HTML entities escaped', () => {
  assert.strictEqual(_esc('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});
test('_esc: ampersand escaped', () => {
  assert.strictEqual(_esc('a&b'), 'a&amp;b');
});
test('_esc: number converted', () => {
  assert.strictEqual(_esc(42), '42');
});

// fmtNum tests
test('fmtNum: normal number', () => {
  assert.strictEqual(TableRenderer.fmtNum(51.234567), '51.235');
});
test('fmtNum: null returns fallback', () => {
  assert.strictEqual(TableRenderer.fmtNum(null), '-');
});
test('fmtNum: custom decimals', () => {
  assert.strictEqual(TableRenderer.fmtNum(51.2, 2), '51.20');
});

// STATUS_MAP tests
test('STATUS_MAP: OK exists', () => {
  assert.ok(TableRenderer.STATUS_MAP.OK.includes('status-ok'));
});
test('STATUS_MAP: DNS exists', () => {
  assert.ok(TableRenderer.STATUS_MAP.DNS.includes('status-dns'));
});
test('STATUS_MAP: DNF exists', () => {
  assert.ok(TableRenderer.STATUS_MAP.DNF.includes('status-dnf'));
});

// escape static method
test('escape: delegates to _esc', () => {
  assert.strictEqual(TableRenderer.escape('<b>'), '&lt;b&gt;');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
