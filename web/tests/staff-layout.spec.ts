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
  await page.keyboard.press('Control+k');
  const search = sidebar.getByRole('searchbox', { name: 'Bereich finden' });
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
  await page.goto('/leitendenbereich/eigenbeleg');
  // The intro waits behind „Was ist das?“, so the form starts high up
  const intro = page.getByText('Für Ausgaben ohne Originalbeleg, z. B. am Parkautomaten');
  await expect(intro).toBeHidden();
  await page.getByText('Was ist das?').click();
  await expect(intro).toBeVisible();

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
