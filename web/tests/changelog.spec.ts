import { test, expect } from './fixtures';
import { CHANGELOG } from '../src/lib/changelogEntries';

const SEEN_ALL = CHANGELOG[0].id;
const SEEN_OLDER = CHANGELOG[2].id;

test.afterEach(async ({ page }) => {
  // Other files of the worker expect an account that has read everything
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_ALL } });
});

test('unread news show a count at the menu, opening them marks them read', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_OLDER } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich');

  const menu = page
    .getByRole('navigation', { name: 'Schnellzugriff' })
    .getByRole('button', { name: 'Menü', exact: true });
  await expect(menu.getByTestId('changelog-badge')).toHaveText('2');
  await expect(menu).toHaveAccessibleDescription('2 neue Neuigkeiten');

  const notice = page.getByRole('status').filter({ hasText: '2 neue Neuigkeiten' });
  await notice.getByRole('link', { name: 'Neuigkeiten lesen' }).click();
  await expect(page.getByRole('heading', { level: 2, name: CHANGELOG[0].title })).toBeVisible();
  await expect(page.getByText('2 Neuigkeiten für dich.')).toBeVisible();
  await expect(page.getByText('Neu', { exact: true })).toHaveCount(2);

  // The next page no longer counts them
  await page.goto('/leitendenbereich');
  await expect(page.getByRole('link', { name: 'Neuigkeiten lesen' })).toHaveCount(0);
  await expect(menu).toHaveAccessibleDescription('');
  await expect(page.getByTestId('changelog-badge')).toHaveCount(0);
});

test('a person who has read everything is told so', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_ALL } });
  await page.goto('/leitendenbereich/neuigkeiten');
  await expect(page.getByText('Du bist auf dem neuesten Stand.')).toBeVisible();
  await expect(page.getByText('Neu', { exact: true })).toHaveCount(0);
  // A change about a specific page links to it
  await expect(page.getByRole('link', { name: '„Fotos“ öffnen' })).toHaveAttribute(
    'href',
    '/leitendenbereich/fotos'
  );
});

test('a failed load of the read state marks nothing as new or read and offers a retry', async ({
  page,
}) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_ALL } });
  let writes = 0;
  let failing = true;
  await page.route('**/api/intern/neuigkeiten', (route) => {
    if (route.request().method() === 'PUT') writes++;
    if (failing && route.request().method() === 'GET') {
      return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    }
    return route.continue();
  });
  await page.goto('/leitendenbereich/neuigkeiten');
  await expect(page.getByText('Dein Lesestand konnte nicht geladen werden.')).toBeVisible();
  await expect(page.getByText('Neu', { exact: true })).toHaveCount(0);
  expect(writes).toBe(0);

  failing = false;
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByText('Du bist auf dem neuesten Stand.')).toBeVisible();
});

test('the page confirms the read state only after it was saved', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_OLDER } });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/neuigkeiten', async (route) => {
    if (route.request().method() === 'PUT') await gate;
    await route.continue();
  });
  await page.goto('/leitendenbereich/neuigkeiten');
  await expect(page.getByText('Gelesen wird gespeichert …')).toBeVisible();
  await expect(page.getByText('gelten jetzt als gelesen')).toHaveCount(0);
  release();
  await expect(page.getByText('gelten jetzt als gelesen')).toBeVisible();
});

test('reading on another device shows at the next page without a full reload', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_OLDER } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich');
  await expect(page.getByTestId('changelog-badge').first()).toHaveText('2');

  // Another device reads everything
  await page.request.put('/api/intern/neuigkeiten', { data: { lastSeenId: SEEN_ALL } });
  await page.getByRole('link', { name: 'Neuigkeiten lesen' }).click();
  await expect(page.getByText('Du bist auf dem neuesten Stand.')).toBeVisible();
  await expect(page.getByText('Neu', { exact: true })).toHaveCount(0);
});

test('an expired login is named and offers a new login instead of a connection check', async ({
  page,
}) => {
  await page.route('**/api/intern/neuigkeiten', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
      : route.continue()
  );
  await page.goto('/leitendenbereich/neuigkeiten');
  await expect(page.getByText('Deine Anmeldung ist abgelaufen.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Neu anmelden (öffnet neuen Tab)' })).toBeVisible();
  await expect(page.getByText('Prüfe deine Internetverbindung')).toHaveCount(0);
});

test('opening the menu keeps the message about a failed save', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_OLDER } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/intern/neuigkeiten', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.continue()
  );
  await page.goto('/leitendenbereich/neuigkeiten');
  await expect(page.getByText('Nicht als gelesen gespeichert.')).toBeVisible();

  // The menu asks the server for the read state again, which succeeds
  const menu = page
    .getByRole('navigation', { name: 'Schnellzugriff' })
    .getByRole('button', { name: 'Menü', exact: true });
  await menu.click();
  await expect(page.getByRole('dialog', { name: 'Alle Bereiche' })).toBeVisible();
  await menu.click();
  await expect(page.getByText('Nicht als gelesen gespeichert.')).toBeVisible();
  await expect(page.getByText('Die Zahl am Menü bleibt deshalb stehen.')).toBeVisible();
});

test('the news link in the menu is described by the number of unread entries', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_OLDER } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  await page
    .getByRole('navigation', { name: 'Schnellzugriff' })
    .getByRole('button', { name: 'Menü', exact: true })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  await expect(sheet.getByRole('link', { name: /^Neuigkeiten/ })).toHaveAccessibleDescription(
    '2 neue Neuigkeiten'
  );
});
