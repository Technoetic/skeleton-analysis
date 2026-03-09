"""Inline-bundle web/src/ into web/dist/index.html"""
import re
from pathlib import Path

SRC = Path("web/src")
DIST = Path("web/dist/index.html")

html = (SRC / "index.html").read_text(encoding="utf-8")

# 1. Replace <link rel="stylesheet" href="css/X"> with <style>contents</style>
def inline_css(m):
    href = m.group(1)
    css_path = SRC / href
    if css_path.exists():
        css = css_path.read_text(encoding="utf-8")
        return f"<style>{css}</style>"
    return m.group(0)

html = re.sub(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', inline_css, html)

# 2. Remove manifest link (not needed in dist)
html = re.sub(r'<link\s+rel="manifest"\s+href="[^"]*"\s*/?>\s*', '', html)

# 3. Replace <script src="js/X"></script> with <script>contents</script>
def inline_js(m):
    src = m.group(1)
    js_path = SRC / src
    if js_path.exists():
        js = js_path.read_text(encoding="utf-8")
        return f"<script>{js}</script>"
    return m.group(0)

html = re.sub(r'<script\s+src="([^"]+)"\s*>\s*</script>', inline_js, html)

DIST.parent.mkdir(parents=True, exist_ok=True)
DIST.write_text(html, encoding="utf-8")
print(f"Built {DIST} ({len(html):,} chars)")
