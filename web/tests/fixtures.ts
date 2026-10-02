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
  const menu = page.getByRole('button', { name: 'Menü öffnen', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await page.locator('#mobile-menu').getByRole('link', { name: label, exact: true }).click();
  } else {
    await page.locator('#site-nav').getByRole('link', { name: label, exact: true }).click();
  }
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerWidth)) + 1
  );
}
