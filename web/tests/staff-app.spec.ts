import { test, expect } from './fixtures';

test('the Leitendenbereich can be installed and opens on its start page', async ({ page }) => {
  await page.goto('/leitendenbereich/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/leitendenbereich.webmanifest');
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    start_url: '/leitendenbereich/',
    display: 'standalone',
    short_name: 'Leitende',
  });
  for (const icon of manifest.icons) {
    expect((await page.request.get(icon.src)).ok(), icon.src).toBe(true);
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png'
  );
  // Logged-in pages and data must never land in a service worker cache
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toEqual([]);
});

test('public pages do not offer the Leitendenbereich for installation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

test('without a connection the Leitendenbereich says that new pages and data cannot load', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/');
  const notice = page.getByText('Keine Verbindung zum Internet.');
  await expect(notice).toBeHidden();
  await context.setOffline(true);
  await expect(notice).toBeVisible();
  await context.setOffline(false);
  await expect(notice).toBeHidden();
});
