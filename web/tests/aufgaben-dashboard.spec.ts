import { prepareTaskTest } from './aufgaben-helpers';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
});
test('favorites are saved for the account, can be removed and survive a failed save', async ({
  page,
}) => {
  await page.goto('/leitendenbereich');
  const favorites = page.getByRole('region', { name: 'Meine Favoriten' });
  await favorites.getByRole('button', { name: 'Favoriten auswählen' }).click();
  await expect(
    favorites.getByText('Häkchen werden sofort gespeichert', { exact: false })
  ).toBeVisible();
  await favorites.getByRole('checkbox', { name: 'Aufgaben', exact: true }).check();
  await expect(favorites.getByText('Favoriten gespeichert.')).toBeVisible();
  // Saved on the server, not in the browser
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();

  await page.route('**/api/intern/favoriten', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 503 }) : route.fallback()
  );
  await favorites.getByRole('button', { name: 'Favoriten auswählen' }).click();
  await favorites.getByRole('checkbox', { name: 'Aktionen', exact: true }).check();
  await expect(favorites.getByText('nicht gespeichert', { exact: false })).toBeVisible();
  await expect(favorites.getByRole('checkbox', { name: 'Aktionen', exact: true })).toBeChecked();
  await page.unroute('**/api/intern/favoriten');
  await favorites.getByRole('button', { name: 'Erneut speichern' }).click();
  await expect(favorites.getByText('Favoriten gespeichert.')).toBeVisible();
  await expect(favorites.getByRole('button', { name: 'Erneut speichern' })).toHaveCount(0);
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aktionen', exact: true })).toBeVisible();

  await favorites.getByRole('button', { name: 'Favoriten auswählen' }).click();
  await favorites.getByRole('checkbox', { name: 'Aufgaben', exact: true }).uncheck();
  await favorites.getByRole('checkbox', { name: 'Aktionen', exact: true }).uncheck();
  await expect(favorites.getByText('Favoriten gespeichert.')).toBeVisible();
  await page.reload();
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
test('favorites from this browser are taken over once and a failed load can be retried', async ({
  page,
}) => {
  await page.goto('/leitendenbereich');
  const userId = await page.evaluate(async () => {
    const response = await fetch('/.auth/me');
    return ((await response.json()) as { clientPrincipal: { userId: string } }).clientPrincipal
      .userId;
  });
  const key = `phoenix:staff-favorites:v1:${userId}`;
  await page.evaluate((storageKey) => {
    localStorage.setItem(storageKey, JSON.stringify(['/leitendenbereich/aufgaben', '/weg']));
  }, key);
  await page.reload();
  const favorites = page.getByRole('region', { name: 'Meine Favoriten' });
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), key))
    .toBeNull();
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();

  await page.route('**/api/intern/favoriten', (route) => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(favorites.getByText('nicht geladen', { exact: false })).toBeVisible();
  await expect(favorites.getByRole('button', { name: 'Favoriten auswählen' })).toBeDisabled();
  await page.unroute('**/api/intern/favoriten');
  await favorites.getByRole('button', { name: 'Erneut laden' }).click();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  await expect(favorites.getByRole('button', { name: 'Favoriten auswählen' })).toBeEnabled();
});
test('dashboard shows upcoming actions and concrete tasks independently of a failed source', async ({
  page,
}) => {
  await page.goto('/leitendenbereich');
  const actions = page.getByRole('region', { name: 'Nächste Aktionen' });
  await expect(actions.getByRole('link').first()).toBeVisible();
  const tasks = page.getByRole('region', { name: 'Offene Aufgaben' });
  await expect(tasks.getByRole('link', { name: 'Küche vorbereiten', exact: true })).toBeVisible();
  await page.route('**/api/intern/aktionen', (route) =>
    route.fulfill({
      status: 502,
      json: { code: 'CAMPFLOW_UNAVAILABLE', message: 'CampFlow ist nicht erreichbar.' },
    })
  );
  await page.reload();
  await expect(actions.getByText('CampFlow ist nicht erreichbar.')).toBeVisible();
  await expect(tasks.getByRole('link', { name: 'Küche vorbereiten', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
