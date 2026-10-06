/**
 * Renders public/og-image.png (1200 × 630), the preview for shared links.
 * Run with: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=… bun scripts/og-image.ts
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const WIDTH = 1200;
const HEIGHT = 630;
const root = new URL('../', import.meta.url);

const lily = readFileSync(new URL('src/assets/stammeslilie.svg', root), 'utf8');
const arvo = readFileSync(
  new URL('node_modules/@fontsource/arvo/files/arvo-latin-700-normal.woff', root)
).toString('base64');
const sourceSans = readFileSync(
  new URL(
    'node_modules/@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2',
    root
  )
).toString('base64');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: Arvo; font-weight: 700; src: url(data:font/woff;base64,${arvo}); }
  @font-face { font-family: 'Source Sans 3'; font-weight: 200 900; src: url(data:font/woff2;base64,${sourceSans}); }
  :root { --lily-color: #000000; --contour-color: #000000; }
  * { margin: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #f8f5ef; color: #003056; display: flex; align-items: center; gap: 90px; padding: 0 110px; position: relative; }
  body::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 14px; background: #810a1a; }
  svg { height: 420px; width: auto; flex-shrink: 0; }
  h1 { font: 700 104px/1.05 Arvo, serif; }
  .rule { width: 160px; height: 8px; background: #810a1a; margin: 30px 0; }
  p { font: 600 44px/1.2 'Source Sans 3', sans-serif; color: #14202c; }
</style></head><body>
  ${lily}
  <div><h1>Stamm Phoenix</h1><div class="rule"></div><p>DPSG Feldkirchen-Westerham</p></div>
</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('public/og-image.png', root).pathname });
await browser.close();
