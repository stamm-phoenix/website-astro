import { test, expect } from './fixtures';

test('the Leitendenbereich can be installed and the app starts on its start page', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/leitendenbereich.webmanifest');
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    start_url: '/leitendenbereich-app/',
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
});

test('the start page of the app opens the Leitendenbereich when logged in', async ({ page }) => {
  await page.goto('/leitendenbereich-app/');
  await expect(page).toHaveURL(/\/leitendenbereich\/$/);
});

test('the start page of the app leads to the login that comes back to the Leitendenbereich', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'mock_logged_out', value: '1', url: baseURL! }]);
  const login = page.waitForRequest((request) => new URL(request.url()).pathname === '/login');
  await page.goto('/leitendenbereich-app/');
  await login;
});

test('the start page of the app says what to do without a connection', async ({ page }) => {
  await page.route('**/.auth/me', (route) => route.abort('internetdisconnected'));
  await page.goto('/leitendenbereich-app/');
  await expect(page.getByRole('status')).toContainText('Prüf deine Internetverbindung');
  await page.unroute('**/.auth/me');
  await page.getByRole('link', { name: 'Noch einmal versuchen' }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/$/);
});

test('no page of the Leitendenbereich registers a service worker', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { swCalls: string[] }).swCalls = calls;
    navigator.serviceWorker.register = (url: string | URL) => {
      calls.push(String(url));
      return Promise.reject(new Error('blocked by test'));
    };
  });
  for (const path of ['/leitendenbereich-app/', '/leitendenbereich/aufgaben']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => (window as unknown as { swCalls: string[] }).swCalls)).toEqual(
      []
    );
  }
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toEqual([]);
});

test('public pages do not offer the Leitendenbereich for installation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

test('without a connection the Leitendenbereich says to keep the page open', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/');
  const notice = page.getByText('Keine Verbindung zum Internet.');
  await expect(notice).toBeHidden();
  await context.setOffline(true);
  await expect(notice).toBeVisible();
  await expect(
    page.getByText('Lass diese Seite offen, deine Eingaben bleiben stehen.')
  ).toBeVisible();
  await context.setOffline(false);
  await expect(notice).toBeHidden();
});

test('the Fahrt view keeps its own offline notice without the general one', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/nikolaus-fahrt');
  await context.setOffline(true);
  await expect(page.getByText('Keine Verbindung zum Internet.')).toHaveCount(0);
  await context.setOffline(false);
});

test('the Abrechnung says that it keeps saving on the device without a connection', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(page.getByRole('tab', { name: 'Leihgebühren' })).toBeVisible();
  await context.setOffline(true);
  const notice = page.getByText('Keine Verbindung zum Internet.');
  await expect(notice).toBeVisible();
  await expect(page.locator('[data-offline-notice]')).toContainText(
    'Deine Eingaben werden weiter auf diesem Gerät gespeichert.'
  );
  await expect(page.locator('[data-offline-notice]')).not.toContainText('Speichern');
  await context.setOffline(false);
});

test('in the iPhone app an expired login is renewed in the same window', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/gruppenstunden/*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/gruppenstunden');
  await page
    .getByRole('button', { name: /^Bearbeiten/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Alter').fill('16 bis 20 Jahre');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText('Kopiere vorher, was du behalten willst.');
  const login = dialog.getByRole('link', { name: 'Neu anmelden', exact: true });
  await expect(login).toHaveAttribute(
    'href',
    `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent('/leitendenbereich/gruppenstunden')}`
  );
  await expect(login).not.toHaveAttribute('target', '_blank');
  await expect(dialog.getByLabel('Alter')).toHaveValue('16 bis 20 Jahre');
});
