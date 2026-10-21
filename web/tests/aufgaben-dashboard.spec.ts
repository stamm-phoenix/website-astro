import { prepareTaskTest } from './aufgaben-helpers';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { toggleFavoriteLikeAPerson } from './favorites-helpers';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
});
test('favorites are set on the areas themselves, saved for the account and survive a failed save', async ({
  page,
}) => {
  // Waits for the popup of a failed save to outlast the usual display time
  test.setTimeout(75_000);
  await page.goto('/leitendenbereich');
  const favorites = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(favorites.getByText('Noch keine Favoriten', { exact: false })).toBeVisible();
  await toggleFavoriteLikeAPerson(page, 'Aufgaben');
  await expect(page.getByText('„Aufgaben“ ist jetzt ein Favorit.')).toBeVisible();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  // Saved on the server, not in the browser
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();

  await page.route('**/api/intern/favoriten', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 503 }) : route.fallback()
  );
  // A long hold changes the favorite and does not open the area as well
  await toggleFavoriteLikeAPerson(page, 'Aktionen', 2000);
  await expect(page.getByText('nicht gespeichert', { exact: false }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/leitendenbereich\/?$/);
  await expect(favorites.getByRole('link', { name: 'Aktionen', exact: true })).toBeVisible();
  // The popup with „Erneut speichern“ stays until it is saved
  await page.waitForTimeout(11_000);
  await expect(page.getByRole('button', { name: 'Erneut speichern' })).toBeVisible();
  // The unsaved choice is not lost by leaving the page by accident
  await page.getByRole('link', { name: 'Alle Aufgaben' }).first().click();
  const leave = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await leave.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/?$/);
  await page.unroute('**/api/intern/favoriten');
  await page.getByRole('button', { name: 'Erneut speichern' }).click();
  await expect(page.getByText('Favoriten gespeichert.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erneut speichern' })).toHaveCount(0);
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aktionen', exact: true })).toBeVisible();

  // An expired login offers to log in again in a new tab; the choice waits for „Erneut speichern“
  await page.route('**/api/intern/favoriten', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await toggleFavoriteLikeAPerson(page, 'Belege');
  await expect(page.getByRole('link', { name: 'Neu anmelden (öffnet neuen Tab)' })).toBeVisible();
  await page.unroute('**/api/intern/favoriten');
  await page.getByRole('button', { name: 'Erneut speichern' }).click();
  await expect(page.getByText('Favoriten gespeichert.')).toBeVisible();
  await toggleFavoriteLikeAPerson(page, 'Belege');
  await expect(page.getByText('„Belege“ ist kein Favorit mehr.')).toBeVisible();

  // The minus on a tile (with a mouse) or a long press (on a touch screen) removes a favorite
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (coarse) {
    await toggleFavoriteLikeAPerson(page, 'Aufgaben');
  } else {
    await favorites.getByRole('link', { name: 'Aufgaben', exact: true }).hover();
    await favorites
      .getByRole('button', { name: 'Aufgaben aus deinen Favoriten entfernen' })
      .click();
  }
  await expect(page.getByText('„Aufgaben“ ist kein Favorit mehr.')).toBeVisible();
  await toggleFavoriteLikeAPerson(page, 'Aktionen');
  await expect(page.getByText('„Aktionen“ ist kein Favorit mehr.')).toBeVisible();
  await page.reload();
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // After discarding a choice that failed to save, the start page shows no stale error
  await page.route('**/api/intern/favoriten', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 503 }) : route.fallback()
  );
  await toggleFavoriteLikeAPerson(page, 'Belege');
  await expect(page.getByText('nicht gespeichert', { exact: false }).first()).toBeVisible();
  await page.unroute('**/api/intern/favoriten');
  await page.getByRole('link', { name: 'Alle Aufgaben' }).first().click();
  await page
    .getByRole('dialog', { name: 'Änderungen verwerfen?' })
    .getByRole('button', { name: 'Änderungen verwerfen' })
    .click();
  await expect(page).toHaveURL(/\/leitendenbereich\/aufgaben/);
  await page.goBack();
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
  await expect(page.getByText('nicht gespeichert', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Erneut speichern' })).toHaveCount(0);
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
  const favorites = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), key))
    .toBeNull();
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();

  await page.route('**/api/intern/favoriten', (route) => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(favorites.getByText('nicht geladen', { exact: false })).toBeVisible();
  // Without loaded favorites, nothing claims there are none
  await expect(favorites.getByText('Noch keine', { exact: false })).toHaveCount(0);
  // Nothing can be marked before the favorites are known
  await expect(page.getByRole('button', { name: 'Aufgaben als Favorit' })).toHaveCount(0);
  await page.unroute('**/api/intern/favoriten');
  await favorites.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aufgaben als Favorit' }).first()).toBeAttached();

  // Back on the start page without a full load, choosing waits until the favorites are loaded
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/favoriten', async (route) => {
    if (route.request().method() === 'GET') await held;
    await route.fallback();
  });
  await page.getByRole('link', { name: 'Alle Aufgaben' }).first().click();
  await expect(page).toHaveURL(/\/leitendenbereich\/aufgaben/);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Aufgaben als Favorit' })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: 'Aufgaben als Favorit' }).first()).toBeAttached();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
});
test('an empty selection from this browser is taken over as well', async ({ page }) => {
  await page.goto('/leitendenbereich');
  await page.evaluate(async () => {
    const response = await fetch('/.auth/me');
    const { clientPrincipal } = (await response.json()) as {
      clientPrincipal: { userId: string };
    };
    localStorage.setItem(`phoenix:staff-favorites:v1:${clientPrincipal.userId}`, '[]');
  });
  await page.reload();
  const favorites = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
  const saved = await page.request.get('/api/intern/favoriten');
  expect(await saved.json()).toEqual({ modules: [] });
});
test('favorites can be loaded again after the login could not be checked', async ({ page }) => {
  await page.route('**/.auth/me', (route) => route.fulfill({ status: 503 }));
  await page.goto('/leitendenbereich');
  const favorites = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(favorites.getByText('nicht geladen', { exact: false })).toBeVisible();
  // Every part of the page has asked for the login once, so none of them loads it meanwhile
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
  await page.unroute('**/.auth/me');
  await favorites.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aufgaben als Favorit' }).first()).toBeAttached();
});
test('a favorite taken back before it was saved still asks before leaving', async ({ page }) => {
  await page.goto('/leitendenbereich');
  const favorites = page.getByRole('region', { name: 'Deine Bereiche' });
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/favoriten', async (route) => {
    if (route.request().method() === 'PUT') await held;
    await route.fallback();
  });
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
  await toggleFavoriteLikeAPerson(page, 'Aufgaben');
  await toggleFavoriteLikeAPerson(page, 'Aufgaben');
  // The first save may already be on the server, so leaving now would keep the removed favorite
  await page.getByRole('link', { name: 'Alle Aufgaben' }).first().click();
  const leave = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await leave.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  release();
  await expect(page.getByText('„Aufgaben“ ist kein Favorit mehr.')).toBeVisible();
  await page.reload();
  await expect(favorites.getByText('Noch keine', { exact: false })).toBeVisible();
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

test('after a failed reload the favorites cannot be changed until they load again', async ({
  page,
}) => {
  await page.goto('/leitendenbereich');
  const star = page.getByRole('button', { name: 'Aufgaben als Favorit' });
  await expect(star.first()).toBeAttached();

  // Back on the start page without a full load, the favorites do not load
  await page.route('**/api/intern/favoriten', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ status: 503 }) : route.fallback()
  );
  await page.getByRole('link', { name: 'Alle Aufgaben' }).first().click();
  await expect(page).toHaveURL(/\/leitendenbereich\/aufgaben/);
  const failed = page.waitForResponse(
    (response) => response.url().endsWith('/api/intern/favoriten') && response.status() === 503
  );
  await page.goBack();
  await failed;
  // Another device may have changed them meanwhile, so the old selection is not saved over them
  await expect(star).toHaveCount(0);
  await expect(page.getByRole('button', { name: /aus deinen Favoriten entfernen/ })).toHaveCount(0);

  await page.unroute('**/api/intern/favoriten');
  await page
    .getByRole('region', { name: 'Deine Bereiche' })
    .getByRole('button', { name: 'Erneut versuchen' })
    .click();
  await expect(star.first()).toBeAttached();
});
