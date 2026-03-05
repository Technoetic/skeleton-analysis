const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

let html = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf-8');

// Inline CSS
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g, (match, href) => {
  if (href.startsWith('http')) return match;
  const cssPath = path.join(srcDir, href);
  if (!fs.existsSync(cssPath)) { console.warn(`  [CSS] Not found: ${href}`); return match; }
  const css = fs.readFileSync(cssPath, 'utf-8');
  console.log(`  [CSS] Inlined: ${href} (${css.length} chars)`);
  return `<style>${css}</style>`;
});

// Inline JS
html = html.replace(/<script\s+src="([^"]+)"[^>]*><\/script>/g, (match, src) => {
  if (src.startsWith('http')) return match;
  const jsPath = path.join(srcDir, src);
  if (!fs.existsSync(jsPath)) { console.warn(`  [JS]  Not found: ${src}`); return match; }
  const js = fs.readFileSync(jsPath, 'utf-8');
  console.log(`  [JS]  Inlined: ${src} (${js.length} chars)`);
  return `<script>${js}</script>`;
});

// Remove manifest link
html = html.replace(/<link\s+rel="manifest"[^>]*>/g, '');

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf-8');

const lines = html.split('\n').length;
const sizeKB = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
console.log(`\n[DONE] dist/index.html created`);
console.log(`       Lines: ${lines}`);
console.log(`       Size:  ${sizeKB} KB`);
