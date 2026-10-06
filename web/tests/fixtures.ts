import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

interface Fixtures {
  offlineDemo: void;
}

export const test = base.extend<Fixtures>({
  offlineDemo: [
    async ({ context, page }, use) => {
      const errors: string[] = [];
      await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
      page.on('pageerror', (error) => errors.push(error.message));
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === 'http://127.0.0.1:4323') {
          await route.continue();
        } else {
          // No requests to real lists, shops, mail services, map providers or embeds.
          await route.abort();
        }
      });
      await use();
      expect(errors, 'No uncaught browser errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Use the site's real menu so links exercise Astro navigation at both widths. */
export async function navigate(page: Page, label: string): Promise<void> {
  // Astro swaps the document before its new module scripts finish loading.
  // Wait for page-load so a following reload cannot abort those imports in WebKit.
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-test-navigation-ready');
    document.addEventListener(
      'astro:page-load',
      () => document.documentElement.setAttribute('data-test-navigation-ready', 'true'),
      { once: true }
    );
  });
  const menu = page.getByRole('button', { name: 'Menü öffnen', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    const link = page.locator('#mobile-menu').getByRole('link', { name: label, exact: true });
    if (!(await link.isVisible())) await page.locator('#mobile-menu summary').click();
    await link.click();
  } else {
    const link = page.locator('#site-nav').getByRole('link', { name: label, exact: true });
    if (!(await link.isVisible())) await page.locator('#site-nav .site-more summary').click();
    await link.click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-test-navigation-ready', 'true');
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerWidth)) + 1
  );
}
