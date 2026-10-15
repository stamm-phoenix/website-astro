import { prepareTaskTest } from './aufgaben-helpers';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { taskStatus, taskFilters, deleteTaskMenu, taskPage } from './aufgaben-helpers';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
});
test('a conflicting task save preserves form input for review', async ({ page }) => {
  await page.goto('/leitendenbereich/aufgaben');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Küche vorbereiten', exact: true }) });
  await row.getByRole('heading').getByRole('button').click();
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

test('Kanban groups tasks by status and preserves project and personal filters', async ({
  page,
}, testInfo) => {
  const title = `Kanban-Aufgabe ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel', { exact: true }).fill(title);
  await dialog.getByLabel('Zuständigkeit', { exact: false }).fill('leitung@example.test');
  await dialog.getByLabel('Projekt', { exact: false }).selectOption({ label: 'Herbstlager' });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await taskStatus(page, 'Alle');
  await page
    .getByRole('group', { name: 'Darstellung', exact: true })
    .getByRole('button', { name: 'Kanban', exact: true })
    .click();
  const open = page.getByRole('region', { name: /^Offen/ });
  const done = page.getByRole('region', { name: /^Erledigt/ });
  const row = (region: typeof open) =>
    region
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(row(open)).toBeVisible();
  await row(open).getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await expect(row(open)).toHaveCount(0);
  await expect(row(done)).toBeVisible();
  await row(done).getByRole('button', { name: 'Wieder öffnen', exact: true }).click();
  await expect(row(open)).toBeVisible();
  await taskFilters(page);
  await page.getByLabel('Nur mir zugewiesen', { exact: true }).check();
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: 'Herbstlager' });
  await expect(row(open)).toBeVisible();
  await page
    .getByRole('group', { name: 'Darstellung', exact: true })
    .getByRole('button', { name: 'Liste', exact: true })
    .click();
  await expect(page.getByLabel('Nur mir zugewiesen', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Projekt', { exact: true })).toHaveValue(/\d+/);
  await expect(
    page
      .getByRole('group', { name: 'Status', exact: true })
      .getByRole('button', { name: 'Alle', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page
    .getByRole('group', { name: 'Darstellung', exact: true })
    .getByRole('button', { name: 'Kanban', exact: true })
    .click();
  await expect(page.getByRole('region', { name: /^Vorschläge/ })).toHaveCount(0);
  await taskFilters(page);
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: 'Ohne Projekt' });
  await expect(row(open)).toHaveCount(0);
  await expect(row(done)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('task deletion and discarding edits use app dialogs without browser prompts', async ({
  page,
}, testInfo) => {
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw new Error(`Unexpected browser prompt: ${dialog.message()}`);
  });
  await page.goto('/leitendenbereich/aufgaben');
  const title = `Dialogtest ${testInfo.project.name}`;
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await page
    .getByRole('dialog', { name: /^Aufgabe (anlegen|bearbeiten)$/ })
    .getByLabel('Titel', { exact: true })
    .fill(title);
  await page
    .getByRole('dialog', { name: /^Aufgabe (anlegen|bearbeiten)$/ })
    .getByRole('button', { name: 'Speichern', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: /^Aufgabe (anlegen|bearbeiten)$/ })
  ).not.toBeVisible();
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(row.getByRole('heading').getByRole('button')).toBeEnabled();
  // The title button intentionally stretches over the metadata; send the real click through it.
  await row.locator('dl').click({ force: true });
  const editor = page.getByRole('dialog', { name: /^Aufgabe (anlegen|bearbeiten)$/ });
  await editor.getByLabel('Titel', { exact: true }).fill('Ungespeicherter Titel');
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(discard.getByRole('button', { name: 'Weiter bearbeiten' })).toBeFocused();
  await discard.press('Escape');
  await expect(editor.getByLabel('Titel', { exact: true })).toHaveValue('Ungespeicherter Titel');
  await editor.getByRole('button', { name: 'Schließen', exact: true }).click();
  await discard.getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(row).toBeVisible();

  let deletes = 0;
  let fail = true;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/intern/pflege/aufgaben/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    deletes++;
    if (fail)
      return route.fulfill({
        status: 409,
        json: { message: 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.' },
      });
    await gate;
    return route.continue();
  });
  await deleteTaskMenu(row);
  const deletion = page.getByRole('dialog', { name: 'Aufgabe löschen', exact: true });
  await expect(deletion).toContainText(title);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `/tmp/phoenix-app-delete-${testInfo.project.name}.png` });
  await deletion.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(deletes).toBe(0);
  await expect(row.getByRole('button', { name: /^Weitere Aktionen:/ })).toBeFocused();
  await deleteTaskMenu(row);
  await deletion.press('Escape');
  expect(deletes).toBe(0);
  await deleteTaskMenu(row);
  await deletion.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(deletion.getByRole('alert')).toContainText('inzwischen geändert');
  await expect(row).toBeAttached();
  fail = false;
  await deletion.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(
    deletion.getByRole('button', { name: 'Wird gelöscht …', exact: true })
  ).toBeDisabled();
  await expect(deletion.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
  release();
  await expect(deletion).not.toBeVisible();
  await expect(row).toHaveCount(0);
  // Removing a card returns focus to a remaining task, or to Add when none remain.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return (
          !!active?.closest('li[id^="aufgabe-"]') ||
          active?.hasAttribute('data-task-focus-fallback')
        );
      })
    )
    .toBe(true);
  expect(deletes).toBe(2);
});

test('open is the default status, view choice persists and completion can be undone', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aufgaben');
  const status = page.getByRole('group', { name: 'Status', exact: true });
  const views = page.getByRole('group', { name: 'Darstellung', exact: true });
  await expect(status.getByRole('button', { name: 'Offen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await views.getByRole('button', { name: 'Kanban', exact: true }).click();
  await page.reload();
  await expect(views.getByRole('button', { name: 'Kanban', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(status.getByRole('button', { name: 'Offen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await views.getByRole('button', { name: 'Liste', exact: true }).click();
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Titel', { exact: true })
    .fill('Andere Aufgabe für Rückgängig');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Andere Aufgabe für Rückgängig', exact: true })
  ).toBeVisible();
  const row = page.locator('#aufgabe-1');
  await expect(
    row.getByRole('button', { name: 'Als erledigt markieren', exact: true })
  ).toBeEnabled();
  const checkbox = (await row
    .getByRole('button', { name: 'Als erledigt markieren', exact: true })
    .boundingBox())!;
  const menuBox = (await row.getByRole('button', { name: /^Weitere Aktionen:/ }).boundingBox())!;
  for (const box of [checkbox, menuBox]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(checkbox.x + checkbox.width).toBeLessThanOrEqual(menuBox.x);
  const originalOrder = await page
    .locator('main li[id^="aufgabe-"]')
    .evaluateAll((items) => items.map((item) => item.id));
  await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await expect(page.getByText('Aufgabe erledigt.', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  const toast = page.locator('[data-toast]').filter({ hasText: 'Aufgabe erledigt.' });
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast).toHaveCSS('position', 'fixed');
  const bounds = (await toast.boundingBox())!;
  const height = await page.evaluate(() => window.innerHeight);
  expect(height - bounds.y - bounds.height).toBeGreaterThanOrEqual(15);
  expect(height - bounds.y - bounds.height).toBeLessThan(80);
  await page.mouse.move(1, 1);
  await page.clock.fastForward(8000);
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Als erledigt markieren', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Änderung rückgängig gemacht.', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.locator('main li[id^="aufgabe-"]').evaluateAll((items) => items.map((item) => item.id))
    )
    .toEqual(originalOrder);
  await taskStatus(page, 'Alle');
  await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toBeVisible();
  let releaseDelete = () => {};
  const deletionGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  await page.route('**/api/intern/pflege/aufgaben/*', async (route) => {
    if (route.request().method() === 'DELETE') await deletionGate;
    await route.continue();
  });
  const other = page.locator('li').filter({
    has: page.getByRole('heading', { name: 'Andere Aufgabe für Rückgängig', exact: true }),
  });
  await deleteTaskMenu(other);
  await page
    .getByRole('dialog', { name: 'Aufgabe löschen', exact: true })
    .getByRole('button', { name: 'Löschen', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Rückgängig', exact: true, includeHidden: true })
  ).toBeDisabled();
  releaseDelete();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Als erledigt markieren', exact: true })
  ).toBeVisible();
  await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toBeEnabled();
  await page.unroute('**/api/intern/pflege/aufgaben/*');
  await page.route('**/api/intern/pflege/aufgaben/1', (route) =>
    route.fulfill({
      status: 409,
      json: { message: 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.' },
    })
  );
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(
    page.getByText('Der Eintrag wurde inzwischen geändert. Bitte neu laden.', { exact: true })
  ).toBeVisible();
  await expect(row.getByRole('button', { name: 'Wieder öffnen', exact: true })).toBeVisible();
  await expect(row.getByRole('heading').getByRole('button')).toHaveCSS(
    'text-decoration-line',
    'line-through'
  );
  await page.unroute('**/api/intern/pflege/aufgaben/1');
  await row.getByRole('button', { name: /^Weitere Aktionen:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Aufgabenaktionen', exact: true });
  await expect(menu.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Schließen', exact: true })).toHaveCount(1);
  await menu.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Aufgabe (anlegen|bearbeiten)$/ })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page
    .getByRole('group', { name: 'Darstellung', exact: true })
    .getByRole('button', { name: 'Kanban', exact: true })
    .click();
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.reload();
  await expect(views.getByRole('button', { name: 'Liste', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await views.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(views.getByRole('button', { name: 'Kanban', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('German dates validate calendar days and empty proposal descriptions use the quote', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: /^Aufgabe (anlegen|bearbeiten)$/ });
  await editor.getByLabel('Titel', { exact: true }).fill('Deutsches Datum');
  const due = editor.getByLabel('Fälligkeit', { exact: false });
  await expect(due).toHaveAttribute('placeholder', 'TT.MM.JJJJ');
  await due.fill('31.02.2027');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('gültiges Datum');
  await due.fill('28.02.2027');
  await page.evaluate(() => {
    HTMLInputElement.prototype.showPicker = () => {
      throw new Error('Picker unavailable');
    };
  });
  await editor.getByRole('button', { name: 'Kalender öffnen', exact: true }).click();
  const picker = editor.getByLabel('Datum im Kalender wählen', { exact: true });
  await expect(picker).toBeVisible();
  await picker.fill('2027-02-27');
  await expect(due).toHaveValue('27.02.2027');
  const saved = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/intern/pflege/aufgaben')
  );
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await saved).postDataJSON().dueDate).toBe('2027-02-27');
  await expect(editor).not.toBeVisible();
  let hasDescription = false;
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tasks = [
      {
        ...data.tasks[0],
        id: 999,
        title: 'Leerer Beschreibungsvorschlag',
        state: 'vorschlag',
        description: hasDescription ? 'Bestehende Beschreibung bleibt erhalten.' : '  \n ',
        assignee: '',
        dueDate: null,
        sourceId: 'prot-7',
        quote: 'Die Zelte vor dem Wochenende prüfen.',
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/aufgaben/vorschlaege');
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Beschreibung', { exact: false })).toHaveValue(
    'Die Zelte vor dem Wochenende prüfen.'
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
  hasDescription = true;
  await page.reload();
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Beschreibung', { exact: false })).toHaveValue(
    'Bestehende Beschreibung bleibt erhalten.'
  );
});

test('toggle applies its versioned response and undo works without reloading the overview', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aufgaben');
  const row = page.locator('#aufgabe-1');
  await expect(
    row.getByRole('button', { name: 'Als erledigt markieren', exact: true })
  ).toBeEnabled();
  let reloads = 0;
  await page.route('**/api/intern/pflege/aufgaben', (route) => {
    reloads++;
    return route.fulfill({ status: 503, json: { message: 'Neuladen fehlgeschlagen.' } });
  });
  await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Als erledigt markieren', exact: true })
  ).toBeVisible();
  expect(reloads).toBe(0);
});

test('segmented choices stay fully visible with multi-digit counts', async ({ page }) => {
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.tasks = Array.from({ length: 123 }, (_, index) => ({
      ...body.tasks[0],
      id: index + 1,
      state: index < 12 ? 'erledigt' : 'offen',
    }));
    await route.fulfill({ response, json: body });
  });
  await page.goto('/leitendenbereich/aufgaben');
  const group = page.getByRole('group', { name: 'Status', exact: true });
  await expect(group.getByRole('button', { name: 'Erledigt', exact: true })).toBeVisible();
  for (const button of await group.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await expectNoHorizontalOverflow(page);
});

test('the mock uses server validators for tasks and templates', async ({ page }) => {
  const invalidDate = await page.request.post('/api/intern/pflege/aufgaben', {
    data: {
      title: 'Ungültige Frist',
      description: '',
      assignee: '',
      dueDate: '2027-02-31',
      projectId: null,
    },
  });
  expect(invalidDate.status()).toBe(400);
  expect((await invalidDate.json()).fields.dueDate).toBeTruthy();
  const invalidTemplate = await page.request.post('/api/intern/pflege/aufgaben/vorlagen', {
    data: { title: 'Ungültige Vorlage', items: [{ title: 'Aufgabe', daysBefore: 400 }] },
  });
  expect(invalidTemplate.status()).toBe(400);
  expect((await invalidTemplate.json()).fields.items).toBeTruthy();
});

test('empty Kanban columns show an appropriate next step and administration links announce counts', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tasks = [];
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/aufgaben');
  await page
    .getByRole('group', { name: 'Darstellung', exact: true })
    .getByRole('button', { name: 'Kanban', exact: true })
    .click();
  await expect(
    page.getByText('Noch keine offenen Aufgaben. Lege eine Aufgabe an.', { exact: true })
  ).toBeVisible();
  await taskStatus(page, 'Erledigt');
  await expect(
    page.getByText('Noch nichts erledigt. Markiere fertige Aufgaben als erledigt.', { exact: true })
  ).toBeVisible();
  await taskFilters(page);
  await page.getByLabel('Nur mir zugewiesen', { exact: true }).check();
  await expect(
    page.getByText('Keine passenden Aufgaben. Passe die Filter an.', { exact: true })
  ).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Planung und Verwaltung', exact: true });
  await expect(navigation.getByRole('link', { name: /^Projekte/ })).toHaveAccessibleName(
    /^Projekte\s*, 1 Projekt\. Vorhaben und ihre Aufgaben verwalten$/
  );
  await expect(navigation.getByRole('link', { name: /^Vorschläge/ })).toHaveAccessibleName(
    /^Vorschläge\s*, 0 Vorschläge\. Aufgaben aus Protokollen prüfen$/
  );
});

test('a saved new task with failed overview refresh reports the saved state without inviting a duplicate', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Aufgabe (anlegen|bearbeiten)$/ });
  await dialog.getByLabel('Titel', { exact: true }).fill('Gespeichert trotz Ladefehler');
  let writes = 0;
  await page.route('**/api/intern/pflege/aufgaben', (route) => {
    if (route.request().method() === 'POST') {
      writes++;
      return route.continue();
    }
    return route.fulfill({ status: 503, json: { message: 'Neuladen fehlgeschlagen.' } });
  });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText('Gespeichert. Die Liste zeigt noch den alten Stand. Lade die Seite neu.', {
      exact: true,
    })
  ).toBeVisible();
  expect(writes).toBe(1);
});

for (const newerOverview of [false, true]) {
  test(`in-flight overview keeps other changes and ${newerOverview ? 'newer server' : 'newer mutation'} task version`, async ({
    page,
  }) => {
    const original = await (await page.request.get('/api/intern/pflege/aufgaben')).json();
    const initial = { ...original.tasks[0], etag: '"0000000000000001"', state: 'offen' };
    await page.route('**/api/intern/pflege/aufgaben', (route) =>
      route.fulfill({ json: { ...original, tasks: [initial] } })
    );
    await page.goto('/leitendenbereich/aufgaben');
    await taskStatus(page, 'Alle');
    const row = page.locator(`#aufgabe-${initial.id}`);
    await expect(
      row.getByRole('button', { name: 'Als erledigt markieren', exact: true })
    ).toBeEnabled();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.unroute('**/api/intern/pflege/aufgaben');
    await page.route('**/api/intern/pflege/aufgaben', async (route) => {
      await blocked;
      return route.fulfill({
        json: {
          ...original,
          projects: [
            ...original.projects,
            { id: 987, title: 'Anderes neues Projekt', etag: '"0000000000000010"', campflowId: '' },
          ],
          tasks: [
            {
              ...initial,
              title: newerOverview ? 'Neuere Serverfassung' : initial.title,
              etag: newerOverview ? '"0000000000000003"' : initial.etag,
            },
          ],
        },
      });
    });
    await page.route(`**/api/intern/pflege/aufgaben/${initial.id}`, (route) =>
      route.fulfill({ json: { ...initial, etag: '"0000000000000002"', state: 'erledigt' } })
    );
    const request = page.waitForRequest(
      (req) => req.method() === 'GET' && req.url().endsWith('/intern/pflege/aufgaben')
    );
    await page.evaluate(async () => {
      const path = '/src/lib/aufgabenStore.svelte.ts';
      const store = await import(path);
      void store.loadTasks();
    });
    await request;
    await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Wieder öffnen', exact: true })).toBeVisible();
    release();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const path = '/src/lib/aufgabenStore.svelte.ts';
          return (await import(path)).aufgabenStore.data.projects.some(
            (project: { id: number }) => project.id === 987
          );
        })
      )
      .toBe(true);
    await expect(
      row.getByRole('button', {
        name: newerOverview ? 'Als erledigt markieren' : 'Wieder öffnen',
        exact: true,
      })
    ).toBeVisible();
    if (newerOverview) await expect(row.getByRole('heading')).toHaveText('Neuere Serverfassung');
  });
}
