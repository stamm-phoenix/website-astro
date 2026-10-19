import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/__mock/zuletzt/reset');
  await page.request.put('/api/intern/favoriten', { data: { modules: [] } });
});
// Other files of the worker expect an account without favorites
test.afterEach(async ({ page }) => {
  await page.request.put('/api/intern/favoriten', { data: { modules: [] } });
});

test('on a wide screen the sidebar leads to every module and finds one by typing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/leitendenbereich/blog/beitrag');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  // One step back instead of a breadcrumb
  await expect(
    page.getByRole('navigation', { name: 'Zurück' }).getByRole('link', { name: 'Blog' })
  ).toHaveAttribute('href', '/leitendenbereich/blog');

  const sidebar = page.getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' });
  await expect(sidebar.getByRole('link', { name: 'Blog', exact: true })).toHaveAttribute(
    'aria-current',
    'true'
  );
  await expect(sidebar.getByRole('link', { name: 'Steuerung' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Schnellzugriff' })).toBeHidden();

  // Strg+K jumps into the search; Enter opens the best match
  await expect(page.locator('astro-island[component-url*="StaffSidebar"]')).not.toHaveAttribute(
    'ssr'
  );
  // In a text editor Strg+K belongs to the editor (links)
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press('Control+k');
  const search = sidebar.getByRole('searchbox', { name: 'Bereich finden' });
  await expect(search).not.toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await search.fill('gruppenst');
  // The best match first; other modules mention Gruppenstunden in their description
  await expect(sidebar.getByRole('link').nth(1)).toHaveText('Gruppenstunden');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/leitendenbereich\/gruppenstunden$/);
  await expect(
    page
      .getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
      .getByRole('link', { name: 'Gruppenstunden' })
  ).toHaveAttribute('aria-current', 'page');
});

test('on a phone the bar at the bottom and the sheet „Menü“ lead to every module', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/protokolle');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  const bar = page.getByRole('navigation', { name: 'Schnellzugriff' });
  await expect(bar).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
  ).toBeHidden();
  // Without favorites, the module just opened comes first, then the usual ones
  await expect(bar.getByRole('link')).toHaveText(['Übersicht', 'Protokolle', 'Aufgaben', 'Belege']);
  await expect(bar.getByRole('link', { name: 'Protokolle' })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await bar.getByRole('button', { name: 'Menü', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  // Every group is open, the account links are at the end
  await expect(sheet.getByRole('link', { name: /^Steuerung/ })).toBeAttached();
  await expect(sheet.getByRole('link', { name: 'Abmelden' })).toHaveAttribute('href', '/logout');
  await sheet.getByRole('searchbox', { name: 'Bereich finden' }).fill('kassenzettel');
  await expect(sheet.getByRole('status')).toHaveText(/1 Bereich gefunden/);
  await sheet.getByRole('link', { name: /^Belege/ }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/belege$/);
  await expect(sheet).toBeHidden();

  // The bar now offers the recently used modules
  await expect(bar.getByRole('link')).toHaveText(['Übersicht', 'Belege', 'Protokolle', 'Aufgaben']);
  await expect(bar.getByRole('link', { name: 'Belege' })).toHaveAttribute('aria-current', 'page');
});

test('the start page lists every area and the recently used ones without opening anything', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The demo API saves the visit after a short delay; the start page should see it
  const visited = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/intern/zuletzt') && response.request().method() === 'POST'
  );
  await page.goto('/leitendenbereich/eigenbeleg');
  // The intro waits behind „Was ist das?“, so the form starts high up
  const intro = page.getByText('Für Ausgaben ohne Originalbeleg, z. B. am Parkautomaten');
  await expect(intro).toBeHidden();
  await page.getByText('Was ist das?').click();
  await expect(intro).toBeVisible();

  await visited;
  await page.goto('/leitendenbereich');
  const yours = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(yours.getByRole('link', { name: 'Eigenbeleg' })).toBeVisible();
  const all = page.getByRole('region', { name: 'Alle Bereiche' });
  const kasse = all.getByRole('region', { name: 'Kasse & Material' });
  for (const name of ['Belege', 'Eigenbeleg', 'Abrechnung', 'Sammelbestellungen']) {
    await expect(kasse.getByRole('link', { name, exact: true })).toBeVisible();
  }

  // The search above finds an area by what it is for
  const search = page.getByRole('main').getByRole('searchbox', { name: 'Bereich finden' });
  await search.filter({ visible: true }).fill('rüsthaus');
  await expect(
    page.getByRole('main').getByRole('link', { name: /^Sammelbestellungen Rüsthaus/ })
  ).toBeVisible();
});

test('the bar shows the same favorites on the start page and after a full page load', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.put('/api/intern/favoriten', {
    data: {
      modules: [
        '/leitendenbereich/aufgaben',
        '/leitendenbereich/belege',
        '/leitendenbereich/protokolle',
        '/leitendenbereich/anwesenheit',
      ],
    },
  });
  const bar = page.getByRole('navigation', { name: 'Schnellzugriff' });
  const favorites = ['Übersicht', 'Aufgaben', 'Belege', 'Protokolle'];
  await page.goto('/leitendenbereich');
  await expect(bar.getByRole('link')).toHaveText(favorites);
  // Aufgaben loads as a full page
  await bar.getByRole('link', { name: 'Aufgaben' }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/aufgaben$/);
  await expect(bar.getByRole('link')).toHaveText(favorites);
});

test('a notice behind the bar at the bottom is repeated in a popup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    (url) => url.pathname === '/api/intern/pflege/aufgaben',
    (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 503 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aufgaben');
  const problem = page.getByText('Die Aufgaben konnten nicht geladen', { exact: false });
  await expect(problem).toHaveCount(1);
  // In a window that ends where the notice is, the bar covers it
  const notice = await problem.boundingBox();
  const bar = await page.getByRole('navigation', { name: 'Schnellzugriff' }).boundingBox();
  await page.setViewportSize({ width: 390, height: Math.round(notice!.y + bar!.height - 8) });
  await page.reload();
  await expect(problem).toHaveCount(2);
});

test('the sidebar folds down to its icons and stays so on the next page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/leitendenbereich/belege');
  await expect(page.locator('astro-island[component-url*="StaffSidebar"]')).not.toHaveAttribute(
    'ssr'
  );
  const sidebar = page.getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' });
  const fold = sidebar.getByRole('button', { name: 'Seitenleiste einklappen' });
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  // A search does not keep filtering the icons once the field is gone
  await sidebar.getByRole('searchbox', { name: 'Bereich finden' }).fill('belege');
  await fold.click();
  const unfold = sidebar.getByRole('button', { name: 'Seitenleiste ausklappen' });
  await expect(unfold).toHaveAttribute('aria-expanded', 'false');
  // Only the icons are left; their names slide out on hover and with the keyboard focus
  await expect(sidebar.getByRole('searchbox')).toHaveCount(0);
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeLessThan(80);
  const flyout = page.getByTestId('staff-flyout');
  await sidebar.getByRole('link', { name: 'Belege', exact: true }).hover();
  await expect(flyout).toHaveText('Belege');
  await sidebar.getByRole('link', { name: 'Aufgaben', exact: true }).focus();
  await expect(flyout).toHaveText('Aufgaben');
  await page.mouse.move(800, 500);
  await page.getByRole('heading', { level: 1 }).click();
  await expect(flyout).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();

  // Moving to another area keeps the folded sidebar as it is, without unfolding it on the way
  await sidebar.evaluate((element) => (element.dataset.kept = 'yes'));
  await sidebar.getByRole('link', { name: 'Eigenbeleg', exact: true }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/eigenbeleg$/);
  await expect(sidebar).toHaveAttribute('data-kept', 'yes');
  await expect(sidebar.getByRole('link', { name: 'Eigenbeleg', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );

  // A full page load shows it folded from the start; the choice stays on this device
  await page.reload();
  expect((await sidebar.boundingBox())?.width).toBeLessThan(80);
  await expect(sidebar.getByRole('button', { name: 'Seitenleiste ausklappen' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('phoenix:staff-sidebar:v1'))).toBe(
    'eingeklappt'
  );
  // Strg+K opens it again for typing
  await page.keyboard.press('Control+k');
  await expect(sidebar.getByRole('searchbox', { name: 'Bereich finden' })).toBeFocused();
  await expect(sidebar.getByRole('button', { name: 'Seitenleiste einklappen' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('phoenix:staff-sidebar:v1'))).toBe(
    'ausgeklappt'
  );
});

/**
 * A swipe with one finger on `selector` by `dy` pixels, in steps like a real finger: `step`
 * milliseconds apart, resting `pause` milliseconds before letting go.
 */
async function swipe(
  page: Page,
  selector: string,
  dy: number,
  { step: stepMs = 30, pause = 0 } = {}
): Promise<void> {
  await page.evaluate(
    async ({ selector, dy, stepMs, pause }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`${selector} missing`);
      const box = target.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y0 = box.top + 20;
      const touch = (y: number): Touch =>
        new Touch({ identifier: 1, target, clientX: x, clientY: y });
      const fire = (type: string, y: number): void => {
        const t = touch(y);
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [t],
            changedTouches: [t],
          })
        );
      };
      fire('touchstart', y0);
      for (let step = 1; step <= 10; step++) {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
        fire('touchmove', y0 + (dy * step) / 10);
      }
      await new Promise((resolve) => setTimeout(resolve, pause));
      fire('touchend', y0 + dy);
    },
    { selector, dy, stepMs, pause }
  );
}

test('on a phone the menu follows the finger: up from the bar opens it, down closes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/belege');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });

  await swipe(page, '[aria-label="Schnellzugriff"]', -300);
  await expect(sheet).toBeInViewport();
  await expect(page).toHaveURL(/\/leitendenbereich\/belege$/);

  // A short pull springs back, a long one closes it
  await swipe(page, '#staff-nav-panel', 40);
  await expect(sheet).toBeInViewport({ ratio: 1 });
  // A quick short pull that rests before letting go is no flick either
  await swipe(page, '#staff-nav-panel', 100, { step: 4, pause: 400 });
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await swipe(page, '#staff-nav-panel', 400);
  await expect(sheet).toBeHidden();
});
