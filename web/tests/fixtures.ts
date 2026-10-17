import { test as base, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

interface Fixtures {
  offlineDemo: void;
}

export const test = base.extend<Fixtures>({
  // Each worker talks to its own dev server (see playwright.config.ts).
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use, testInfo) => {
    await use(
      `http://127.0.0.1:${Number(process.env.E2E_PORT_BASE ?? 4323) + testInfo.parallelIndex}`
    );
  },
  offlineDemo: [
    async ({ context, page, baseURL }, use) => {
      const errors: string[] = [];
      await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
      // WebKit reports a request to our own origin that the next navigation cut off (an
      // island still loading its data, a debounced lookup) as an uncaught error that ends in
      // "due to access control checks.". A request to the same origin cannot fail those
      // checks, so such a message is the cut-off request, not an error of the page.
      const host = new URL(baseURL ?? 'http://127.0.0.1').host;
      const cutOffByNavigation = (message: string): boolean =>
        message.includes(host) && message.endsWith('due to access control checks.');
      page.on('pageerror', (error) => {
        if (!cutOffByNavigation(error.message)) errors.push(error.message);
      });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === baseURL) {
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

interface NavigationWindow {
  testNavigation?: 'pending' | 'done';
}

/** Use the site's real menu so links exercise Astro navigation at both widths. */
export async function navigate(page: Page, label: string): Promise<void> {
  // Astro swaps the document before its new module scripts finish loading.
  // Wait for page-load so a following reload cannot abort those imports in WebKit.
  // The flag lives on window, which Astro navigation keeps while it replaces the attributes
  // of <html>; a full page load drops it, so a lost client-side navigation stays visible.
  await page.evaluate(() => {
    const scope = window as unknown as NavigationWindow;
    scope.testNavigation = 'pending';
    document.addEventListener(
      'astro:page-load',
      () => {
        scope.testNavigation = 'done';
      },
      { once: true }
    );
  });
  const menu = page.getByRole('button', { name: 'Menü öffnen', exact: true });
  // The menu button is a client:only island. Wait until one of the two navigations is
  // shown, otherwise a slow hydration sends narrow viewports to the hidden desktop nav.
  const desktopNav = page.locator('#site-nav nav[aria-label="Hauptnavigation"]');
  await expect(menu.or(desktopNav).filter({ visible: true })).toHaveCount(1);
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
  // Loading the new page's modules from the dev server takes WebKit on a busy runner
  // longer than the default 5 s.
  await expect
    .poll(
      () =>
        page
          .evaluate(() => (window as unknown as NavigationWindow).testNavigation ?? 'lost')
          .catch(() => 'pending'),
      { message: 'Astro navigation finished (astro:page-load)', timeout: 15_000 }
    )
    .toBe('done');
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.evaluate(() => window.innerWidth)) + 1
  );
}

/** Answers the app's own confirmation dialog (`confirmAction`) by clicking `button`. */
export async function answerConfirm(page: Page, title: string, button: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Fails when the element lies (partly) beside the window, e.g. in a table scrolled sideways. */
export async function expectWithinWindowWidth(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x, 'left edge').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(width);
}
