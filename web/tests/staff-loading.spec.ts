import { test, expect } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('areas are usable within 1.5 seconds while every API response takes eight seconds', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.fallback();
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 50,
    downloadThroughput: 1_000_000,
    uploadThroughput: 100_000,
  });
  // Warm Astro's server-side compilation, keeping the browser cache empty.
  await page.request.get('/leitendenbereich');
  const start = performance.now();
  await page.goto('/leitendenbereich', { waitUntil: 'commit' });
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(areas.getByRole('link').first()).toBeVisible({ timeout: 1500 });
  const elapsed = Math.round(performance.now() - start);
  console.log(`Areas visible after ${elapsed} ms`);
  expect(elapsed).toBeLessThanOrEqual(1500);
  await expect(areas.locator('.skeleton-element')).toHaveCount(0);
  const link = areas.getByRole('link').first();
  await expect(link).toHaveText(/\S/);
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('a delayed selection keeps the focused tile and its position', async ({ page }) => {
  await page.route('**/api/intern/favoriten', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ json: { modules: ['/leitendenbereich/belege'] } });
  });
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const first = areas.getByRole('link').first();
  await expect(first).toBeVisible({ timeout: 1500 });
  await first.focus();
  const href = await first.getAttribute('href');
  const position = await first.boundingBox();
  await expect(
    areas.getByRole('button', { name: 'Belege aus deinen Favoriten entfernen' })
  ).toBeVisible();
  const focused = areas.locator(`a[href="${href}"]`);
  await expect(focused).toBeFocused();
  expect(await focused.boundingBox()).toEqual(position);
});

test('a failed favorites request retains areas and offers retry', async ({ page }) => {
  let failed = true;
  await page.route('**/api/intern/favoriten', async (route) => {
    if (failed) await route.fulfill({ status: 503, json: {} });
    else await route.fulfill({ json: { modules: ['/leitendenbereich/belege'] } });
  });
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(areas.getByText(/Deine Favoriten konnten nicht geladen werden/)).toBeVisible();
  await expect(areas.getByRole('link').first()).toBeVisible();
  failed = false;
  await areas.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(
    areas.getByRole('button', { name: 'Belege aus deinen Favoriten entfernen' })
  ).toBeVisible();
});

test('areas remain readable and keyboard accessible in the dark theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const links = areas.getByRole('link');
  await expect(links).toHaveCount(8);
  await links.first().focus();
  await page.keyboard.press('Tab');
  // A loaded favorite can have its remove button between two links.
  const active = await page.evaluate(() =>
    document.activeElement?.closest('section')?.getAttribute('aria-labelledby')
  );
  expect(active).toBe('favorites-heading');
  await page.screenshot({ path: '/tmp/421-dashboard-dark.png', fullPage: true });
});

test('a delayed selection keeps the touched tile until the interaction is canceled', async ({
  page,
}) => {
  await page.route('**/api/intern/favoriten', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ json: { modules: ['/leitendenbereich/belege'] } });
  });
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const tile = areas.getByRole('link', { name: 'Aufgaben', exact: true });
  await expect(tile).toBeVisible({ timeout: 1500 });
  await tile.dispatchEvent('pointerdown', { pointerType: 'touch' });
  const before = await tile.boundingBox();
  await expect(
    areas.getByRole('button', { name: 'Belege aus deinen Favoriten entfernen' })
  ).toBeVisible();
  expect(await tile.boundingBox()).toEqual(before);
  await tile.dispatchEvent('pointercancel', { pointerType: 'touch' });
  await expect(areas.getByRole('link').first()).toHaveText('Belege');
});

test('removing a favorite through its keyboard control releases the tile', async ({ page }) => {
  await page.request.put('/api/intern/favoriten', {
    data: { modules: ['/leitendenbereich/mitglieder'] },
  });
  await page.route('**/api/intern/zuletzt', (route) => route.fulfill({ json: { modules: [] } }));
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const remove = areas.getByRole('button', { name: 'Mitglieder aus deinen Favoriten entfernen' });
  await expect(remove).toBeVisible();
  await areas.getByRole('link', { name: 'Mitglieder', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(areas.getByRole('link', { name: 'Mitglieder', exact: true })).toHaveCount(0);
  await expect(areas.getByRole('link')).toHaveCount(8);
});

test('leaving a different tile with the mouse preserves the keyboard focus', async ({ page }) => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/favoriten', async (route) => {
    await held;
    await route.fulfill({
      json: {
        modules: [
          '/leitendenbereich/mitglieder',
          '/leitendenbereich/aktionen',
          '/leitendenbereich/abrechnung',
          '/leitendenbereich/beitraege',
          '/leitendenbereich/gruppenstunden',
          '/leitendenbereich/leitende',
          '/leitendenbereich/blog',
          '/leitendenbereich/downloads',
        ],
      },
    });
  });
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const tasks = areas.getByRole('link', { name: 'Aufgaben', exact: true });
  await tasks.focus();
  const before = await tasks.boundingBox();
  await areas
    .getByRole('link', { name: 'Belege', exact: true })
    .dispatchEvent('pointerleave', { pointerType: 'mouse' });
  release();
  await expect(
    areas.getByRole('button', { name: 'Mitglieder aus deinen Favoriten entfernen' })
  ).toBeVisible();
  await expect(tasks).toBeFocused();
  expect(await tasks.boundingBox()).toEqual(before);
});

test('favorites have one loading announcement', async ({ page }) => {
  await page.route('**/api/intern/favoriten', () => new Promise(() => {}));
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(areas.getByText('Favoriten werden geladen …', { exact: true })).toHaveCount(1);
});
