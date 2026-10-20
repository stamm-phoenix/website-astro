/**
 * Renders the icons of the installable Leitendenbereich (public/leitendenbereich.webmanifest)
 * and the Apple touch icon.
 * Run with: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=… bun scripts/app-icons.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = new URL('../', import.meta.url);
const lily = readFileSync(new URL('src/assets/stammeslilie.svg', root), 'utf8');

// `padding` is the share of the side kept free around the lily. Maskable icons and the Apple
// icon are cropped by the platform (circle, rounded square), so they need more space.
const ICONS = [
  { file: 'app-icon-192.png', size: 192, padding: 0.12 },
  { file: 'app-icon-512.png', size: 512, padding: 0.12 },
  { file: 'app-icon-maskable-512.png', size: 512, padding: 0.24 },
  { file: 'apple-touch-icon.png', size: 180, padding: 0.16 },
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
for (const { file, size, padding } of ICONS) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { --lily-color: #000000; --contour-color: #000000; }
  * { margin: 0; box-sizing: border-box; }
  body { width: ${size}px; height: ${size}px; background: #f8f5ef; display: flex; align-items: center; justify-content: center; }
  svg { height: ${Math.round(size * (1 - 2 * padding))}px; width: auto; }
</style></head><body>${lily}</body></html>`;
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html);
  await page.screenshot({ path: fileURLToPath(new URL(`public/${file}`, root)) });
  await page.close();
}
await browser.close();
