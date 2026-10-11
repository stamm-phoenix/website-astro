import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.beforeEach(async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' });
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
  await favorites.getByRole('button', { name: 'Aufgaben aus Favoriten entfernen' }).click();
  await page.reload();
  await expect(favorites.getByRole('link', { name: 'Aufgaben', exact: true })).toHaveCount(0);
  await expect(favorites.getByText('Wähle die Bereiche', { exact: false })).toBeVisible();
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
test('create a project and template, apply once, assign and complete a task', async ({
  page,
}, testInfo) => {
  const projectTitle = `Testlager ${testInfo.project.name}`;
  const templateTitle = `Testvorlage ${testInfo.project.name}`;
  const taskTitle = `Testzelte prüfen ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel', { exact: true }).fill(projectTitle);
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Vorlagen', exact: true }).click();
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await dialog.getByLabel('Titel', { exact: true }).fill(templateTitle);
  await dialog.getByLabel('Aufgabentitel').fill(taskTitle);
  await dialog.getByLabel('Tage vor der Aktion').fill('7');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Checkliste aus Vorlage', exact: true }).click();
  await dialog.getByLabel('Projekt', { exact: true }).selectOption({ label: projectTitle });
  await dialog.getByLabel('Vorlage', { exact: true }).selectOption({ label: templateTitle });
  await dialog.getByLabel('Datum der Aktion').fill('2026-11-01');
  const checklistRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith('/intern/pflege/aufgaben/checkliste')
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  const checklistBody = (await checklistRequest).postDataJSON();
  expect(typeof checklistBody.projectId).toBe('number');
  expect(typeof checklistBody.templateId).toBe('number');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Offen', exact: true }).click();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) });
  await expect(row.getByText('Fällig: 2026-10-25', { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await dialog.getByLabel('Zuständigkeit', { exact: false }).fill('bea@example.test');
  const taskRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' && /\/intern\/pflege\/aufgaben\/\d+$/.test(request.url())
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect(typeof (await taskRequest).postDataJSON().projectId).toBe('number');
  await expect(dialog).not.toBeVisible();
  await expect(row.getByText('bea@example.test', { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'Erledigt', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Aufgabenansicht' })
    .getByRole('button', { name: 'Erledigt', exact: true })
    .click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Checkliste aus Vorlage', exact: true }).click();
  await dialog.getByLabel('Projekt', { exact: true }).selectOption({ label: projectTitle });
  await dialog.getByLabel('Vorlage', { exact: true }).selectOption({ label: templateTitle });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText('Diese Vorlage wurde für das Projekt bereits angewendet.').first()
  ).toBeVisible();
  await expect(row).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
test('protocol proposals need explicit corrected acceptance and are not duplicated on recognition', async ({
  page,
}, testInfo) => {
  const sourceId = testInfo.project.name === 'mobile' ? 'prot-6' : 'prot-7';
  await page.goto(`/leitendenbereich/aufgaben?protokoll=${sourceId}`);
  await page.getByRole('button', { name: 'Aufgaben erkennen', exact: true }).click();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.locator(`a[href="/leitendenbereich/protokolle#protokoll-${sourceId}"]`) });
  await expect(row.getByText('Alex plant die Lagerküche.')).toBeVisible();
  await row.getByRole('button', { name: 'Prüfen und annehmen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Zuständigkeit', { exact: false }).fill('bea@example.test');
  await dialog.getByLabel('Fälligkeit', { exact: false }).fill('2026-10-20');
  await dialog.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Aufgaben erkennen', exact: true }).click();
  await expect(
    page.getByText('Keine neuen Aufgabenvorschläge gefunden.', { exact: false }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Offen', exact: true }).click();
  await expect(row).toHaveCount(1);
  await expect(row.getByText('bea@example.test', { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
test('a conflicting task save preserves form input for review', async ({ page }) => {
  await page.goto('/leitendenbereich/aufgaben');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Küche vorbereiten', exact: true }) });
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel', { exact: true }).fill('Mein neuer Entwurf');
  await page.route('**/api/intern/pflege/aufgaben/1', (route) =>
    route.fulfill({
      status: 409,
      json: { message: 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.' },
    })
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    dialog.getByText('Der Eintrag wurde inzwischen geändert. Bitte neu laden.')
  ).toBeVisible();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Mein neuer Entwurf');
});
