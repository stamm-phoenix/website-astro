import { prepareTaskTest } from './aufgaben-helpers';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
});
test('favorites persist per account, can be removed and work with blocked storage', async ({
  page,
}) => {
  await page.goto('/leitendenbereich');
  const favorites = page.getByRole('region', { name: 'Meine Favoriten' });
  await favorites.getByRole('button', { name: 'Favoriten auswählen' }).click();
  await favorites.getByRole('checkbox', { name: 'Aufgaben', exact: true }).check();
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  await page.route('**/.auth/me', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.clientPrincipal.userId = 'another-test-account';
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(favorites.getByRole('button', { name: 'Favoriten auswählen' })).toBeEnabled();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toHaveCount(0);
  await page.unroute('**/.auth/me');
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  await favorites.getByRole('button', { name: 'Favoriten auswählen' }).click();
  await favorites.getByRole('checkbox', { name: 'Aufgaben', exact: true }).uncheck();
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toHaveCount(0);
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.reload();
  await favorites.getByRole('button', { name: 'Favoriten auswählen' }).click();
  await favorites.getByRole('checkbox', { name: 'Aufgaben', exact: true }).check();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  await expect(favorites.getByText('Favoriten lassen sich', { exact: false })).toBeVisible();
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
    route.fulfill({ status: 502, json: { message: 'CampFlow ist nicht erreichbar.' } })
  );
  await page.reload();
  await expect(actions.getByText('CampFlow ist nicht erreichbar.')).toBeVisible();
  await expect(tasks.getByRole('link', { name: 'Küche vorbereiten', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
