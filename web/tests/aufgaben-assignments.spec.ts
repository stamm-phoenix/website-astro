import { prepareTaskTest } from './aufgaben-helpers';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { taskFilters, taskPage } from './aufgaben-helpers';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
});
test('autocomplete saves a selected login and legacy full names remain in the personal filter and dashboard', async ({
  page,
}, testInfo) => {
  const login = 'hugo.beispiel@stamm-phoenix.de';
  const title = `Autocomplete ${testInfo.project.name}`;
  await page.route('**/api/intern/pflege/aufgaben/benutzer', (route) =>
    route.fulfill({
      json: {
        users: [
          { name: 'Hugo Beispiel', login },
          { name: 'Hugo Anders', login: 'hugo.anders@stamm-phoenix.de' },
        ],
        unavailable: false,
      },
    })
  );
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const data = await response.json();
    data.login = login;
    data.tasks.push({
      ...data.tasks[0],
      id: 9999,
      title: 'Bestehende Namenszuweisung',
      assignee: 'Hugo Beispiel',
      dueDate: null,
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/aufgaben');
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const assignee = dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false });
  await assignee.fill('Hugo');
  await expect(dialog.getByRole('option', { name: 'Hugo Beispiel', exact: true })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Hugo Anders/ })).toBeVisible();
  await assignee.press('ArrowDown');
  await assignee.press('Enter');
  await expect(
    dialog.getByRole('button', { name: 'Hugo Beispiel entfernen', exact: true })
  ).toBeVisible();
  await expect(assignee).toHaveValue('');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Titel', { exact: true }).fill(title);
  const request = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith('/intern/pflege/aufgaben')
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await request).postDataJSON().assignee).toBe(login);
  await expect(dialog).not.toBeVisible();
  await taskFilters(page);
  await page.getByLabel('Nur mir zugewiesen').check();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Bestehende Namenszuweisung', exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto('/leitendenbereich');
  const tasks = page.getByRole('region', { name: 'Offene Aufgaben' });
  await expect(tasks.getByText('2 dir zugewiesen', { exact: false })).toBeVisible();
  await expect(tasks.getByRole('link', { name: title, exact: true })).toBeVisible();
  await expect(
    tasks.getByRole('link', { name: 'Bestehende Namenszuweisung', exact: true })
  ).toBeVisible();
});
test('template assignees support pointer selection and unavailable autocomplete keeps manual full-name entry usable', async ({
  page,
}, testInfo) => {
  const login = 'hugo.beispiel@stamm-phoenix.de';
  await page.route('**/api/intern/pflege/aufgaben/benutzer', (route) =>
    route.fulfill({
      json: {
        users: [{ name: 'Hugo Beispiel', login }],
        unavailable: false,
      },
    })
  );
  await page.goto('/leitendenbereich/aufgaben');
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Vorlagen\b/ })
    .click();
  await page.getByRole('button', { name: 'Vorlage anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).fill('Hugo');
  const option = dialog.getByRole('option', { name: 'Hugo Beispiel', exact: true });
  if (testInfo.project.name === 'mobile') await option.tap();
  else await option.click();
  await expect(
    dialog.getByRole('button', { name: 'Hugo Beispiel entfernen', exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.unroute('**/api/intern/pflege/aufgaben/benutzer');
  await page.route('**/api/intern/pflege/aufgaben/benutzer', (route) =>
    route.fulfill({ json: { users: [], unavailable: true } })
  );
  await page.reload();
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await expect(
    dialog.getByText('Personensuche gerade nicht verfügbar', { exact: false })
  ).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('Zuordnung prüfen');
  const person = dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false });
  await person.fill('Hugo');
  await person.press('Tab');
  await expect(
    dialog.getByText('Bitte tippe auf einen Namen aus der Liste – oder lass das Feld leer.')
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).fill('Hugo Beispiel');
  await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Hugo Beispiel entfernen', exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  const saved = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith('/intern/pflege/aufgaben')
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await saved).postDataJSON().assignees).toEqual([{ name: 'Hugo Beispiel', login: '' }]);
  await expect(dialog).not.toBeVisible();
});

test('multiple people appear as removable name tags and any assignee sees the task in their personal view', async ({
  page,
}, testInfo) => {
  const alex = { name: 'Alex Beispiel', login: 'alex@example.test' };
  const bea = { name: 'Bea Beispiel', login: 'bea@example.test' };
  const title = `Gemeinsame Aufgabe ${testInfo.project.name}`;
  await page.route('**/api/intern/pflege/aufgaben/benutzer', (route) =>
    route.fulfill({ json: { users: [alex, bea], unavailable: false } })
  );
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const data = await response.json();
    data.login = bea.login;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/aufgaben');
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const search = dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false });
  await dialog.getByLabel('Titel', { exact: true }).fill(title);
  for (const person of [alex, bea]) {
    await search.fill(person.name.split(' ')[0]);
    await dialog.getByRole('option', { name: person.name, exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: `${person.name} entfernen`, exact: true })
    ).toBeVisible();
  }
  await expect(search).toHaveValue('');
  await search.fill('Alex');
  await expect(dialog.getByRole('option', { name: alex.name, exact: true })).toHaveCount(0);
  await search.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Alex entfernen', exact: true })).toHaveCount(0);
  await search.fill('');
  const request = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith('/intern/pflege/aufgaben')
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await request).postDataJSON().assignees).toEqual([alex, bea]);
  await expect(dialog).not.toBeVisible();
  await taskFilters(page);
  await page.getByLabel('Nur mir zugewiesen').check();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(row.getByText('Alex Beispiel, Bea Beispiel', { exact: false })).toBeVisible();
  await expect(row.getByText('@example.test', { exact: false })).toHaveCount(0);
  await row.getByRole('heading').getByRole('button').click();
  await dialog.getByRole('button', { name: 'Bea Beispiel entfernen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await taskFilters(page);
  await page.getByLabel('Nur mir zugewiesen').uncheck();
  await expect(row.getByText('Alex Beispiel', { exact: false })).toBeVisible();
  await row.getByRole('heading').getByRole('button').click();
  await dialog.getByRole('button', { name: 'Alex Beispiel entfernen', exact: true }).click();
  await search.fill('Bea');
  await dialog.getByRole('option', { name: bea.name, exact: true }).click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/leitendenbereich');
  const tasks = page.getByRole('region', { name: 'Offene Aufgaben' });
  const entry = tasks
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });
  await expect(entry.getByText('Bea Beispiel', { exact: false })).toBeVisible();
  await expect(entry.getByText('@example.test', { exact: false })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
