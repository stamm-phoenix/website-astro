import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/** Reads width and height from the IHDR chunk of a PNG. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(1, 4).toString('ascii'), 'PNG signature').toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function meta(page: Page, selector: string): Promise<string | null> {
  return page.locator(`head > meta${selector}`).getAttribute('content');
}

test.describe('Social preview image', () => {
  test('points to an existing raster image with the declared size', async ({ page, request }) => {
    await page.goto('/impressum');

    const ogImage = await meta(page, '[property="og:image"]');
    expect(ogImage).toMatch(/^https:\/\/.+\.png$/);
    expect(await meta(page, '[name="twitter:image"]')).toBe(ogImage);
    expect(await meta(page, '[property="og:image:type"]')).toBe('image/png');
    expect(await meta(page, '[property="og:image:alt"]')).toBeTruthy();

    // The absolute URL targets the production host; fetch the same path from the dev server.
    const response = await request.get(new URL(ogImage ?? '').pathname);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');

    const size = pngSize(await response.body());
    expect(await meta(page, '[property="og:image:width"]')).toBe(String(size.width));
    expect(await meta(page, '[property="og:image:height"]')).toBe(String(size.height));
    expect(size).toEqual({ width: 1200, height: 630 });
  });

  test('a page with its own image overrides the default and its size', async ({ page }) => {
    await page.goto('/blog/9/');

    const ogImage = await meta(page, '[property="og:image"]');
    expect(ogImage).not.toMatch(/og-image\.png$/);
    expect(await meta(page, '[name="twitter:image"]')).toBe(ogImage);
    // Neither the default size nor the default type may leak onto another image.
    await expect(page.locator('head > meta[property="og:image:type"]')).toHaveCount(0);
    expect(await meta(page, '[property="og:image:width"]')).not.toBe('1200');
  });
});

test.describe('Image dimensions', () => {
  async function expectDimensions(page: Page, selector: string): Promise<void> {
    const images = page.locator(selector);
    expect(await images.count(), `${selector} exists`).toBeGreaterThan(0);
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute('width', /^\d+$/);
      await expect(image).toHaveAttribute('height', /^\d+$/);
    }
  }

  test('imprint DPSG logo reserves its space', async ({ page }) => {
    await page.goto('/impressum');
    await expectDimensions(page, 'img[src*="dpsg_logo_cmyk"]');
  });

  test('footer brand marks reserve their space', async ({ page }) => {
    await page.goto('/impressum');
    await expectDimensions(page, 'footer .brand-mark');
  });
});
