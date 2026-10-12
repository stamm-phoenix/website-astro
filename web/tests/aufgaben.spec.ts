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
  await expect(row.getByText('Fällig: 25.10.2026', { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  for (const remove of await dialog.getByRole('button', { name: /entfernen$/ }).all())
    await remove.click();
  await dialog.getByLabel('Zuständigkeit', { exact: false }).fill('bea@example.test');
  const taskRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' && /\/intern\/pflege\/aufgaben\/\d+$/.test(request.url())
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect(typeof (await taskRequest).postDataJSON().projectId).toBe('number');
  await expect(dialog).not.toBeVisible();
  await expect(row.getByText('Bea Beispiel', { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
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
  await expect(row.getByText('Alex plant die Lagerküche für die Winteraktion.')).toBeVisible();
  await row.getByRole('button', { name: 'Prüfen und annehmen' }).click();
  const dialog = page.getByRole('dialog');
  for (const remove of await dialog.getByRole('button', { name: /entfernen$/ }).all())
    await remove.click();
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
  await expect(row.getByText('Bea Beispiel', { exact: false })).toBeVisible();
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

test('reviewers can reject proposals during a protocol outage while ordinary staff cannot', async ({
  page,
}) => {
  let reviewer = false;
  let remaining = true;
  const proposal = {
    id: 900,
    etag: '"test-proposal"',
    title: 'Veralteter Vorschlag',
    description: '',
    assignee: '',
    dueDate: null,
    projectId: null,
    state: 'vorschlag',
    sourceId: 'unavailable-protocol',
    sourceVersion: 'old-version',
    quote: 'Alex prüft die Zelte.',
  };
  await page.route('**/api/intern/pflege/protokolle', (route) =>
    route.fulfill({ status: 502, json: { message: 'SharePoint ist nicht erreichbar.' } })
  );
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        reviewer,
        tasks: remaining ? [proposal] : [],
      },
    });
  });
  await page.route('**/api/intern/pflege/aufgaben/900/entscheidung', (route) => {
    expect(route.request().postDataJSON()).toEqual({ etag: proposal.etag, action: 'ablehnen' });
    remaining = false;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/leitendenbereich/aufgaben?protokoll=unavailable-protocol');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: proposal.title }) });
  await expect(row.getByRole('button', { name: 'Ablehnen', exact: true })).toBeDisabled();
  reviewer = true;
  await page.reload();
  await expect(page.getByText('SharePoint ist nicht erreichbar.', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Ablehnen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  const proposals = page.getByRole('region', { name: /^Vorschläge/ });
  await expect(proposals.getByRole('heading', { name: proposal.title })).toBeVisible();
  await proposals.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('Kanban groups tasks by status and preserves project and personal filters', async ({
  page,
}, testInfo) => {
  const title = `Kanban-Aufgabe ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel', { exact: true }).fill(title);
  await dialog.getByLabel('Zuständigkeit', { exact: false }).fill('leitung@example.test');
  await dialog.getByLabel('Projekt', { exact: false }).selectOption({ label: 'Herbstlager' });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
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
  await page.getByLabel('Nur mir zugewiesen', { exact: true }).check();
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: 'Herbstlager' });
  await expect(row(open)).toBeVisible();
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: 'Ohne Projekt' });
  await expect(row(open)).toHaveCount(0);
  await expect(row(done)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('a tagged existing proposal receives a login and appears in the personal task filter after acceptance', async ({
  page,
}) => {
  let task = {
    id: 980,
    etag: '"tagged"',
    title: 'Flyer erstellen',
    description: '',
    assignee: 'Demo Leitung',
    dueDate: null,
    projectId: null,
    state: 'vorschlag',
    sourceId: 'tagged-protocol',
    sourceVersion: 'v1',
    quote: '@Demo Leitung erstellt die Flyer.',
  };
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), reviewer: true, tasks: [task] },
    });
  });
  await page.route('**/api/intern/pflege/aufgaben/980/zuordnung', (route) =>
    route.fulfill({ json: { assignee: 'leitung@example.test', unavailable: false } })
  );
  await page.route('**/api/intern/pflege/aufgaben/980/entscheidung', (route) => {
    const body = route.request().postDataJSON();
    expect(body.action).toBe('annehmen');
    expect(body.assignee).toBe('leitung@example.test');
    task = { ...task, assignee: body.assignee, state: 'offen', etag: '"accepted"' };
    return route.fulfill({ status: 204 });
  });
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Vorschläge', exact: true }).click();
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Demo Leitung entfernen', exact: true })
  ).toBeVisible();
  await expect(dialog.getByText('Tag automatisch zugeordnet:', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Offen', exact: true }).click();
  await page.getByLabel('Nur mir zugewiesen', { exact: true }).check();
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
});

test('a late tag lookup preserves reviewer edits and unavailable mapping allows manual review', async ({
  page,
}) => {
  const task = {
    id: 981,
    etag: '"tagged"',
    title: 'Material prüfen',
    description: '',
    assignee: 'Demo Leitung',
    dueDate: null,
    projectId: null,
    state: 'vorschlag',
    sourceId: 'tagged-protocol',
    sourceVersion: 'v1',
    quote: '@Demo Leitung prüft das Material.',
  };
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), reviewer: true, tasks: [task] },
    });
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/intern/pflege/aufgaben/981/zuordnung', async (route) => {
    await gate;
    await route.fulfill({ json: { assignee: 'leitung@example.test', unavailable: false } });
  });
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Vorschläge', exact: true }).click();
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Annehmen', exact: true })).toBeDisabled();
  await dialog.getByLabel('Zuständigkeit', { exact: false }).fill('andere@example.test');
  release();
  await expect(dialog.getByText('Deine Eingabe bleibt erhalten.', { exact: false })).toBeVisible();
  await expect(dialog.getByLabel('Zuständigkeit', { exact: false })).toHaveValue(
    'andere@example.test'
  );
  await expect(dialog.getByRole('button', { name: 'Annehmen', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Änderungen verwerfen?' })
    .getByRole('button', { name: 'Änderungen verwerfen', exact: true })
    .click();
  await page.unroute('**/api/intern/pflege/aufgaben/981/zuordnung');
  await page.route('**/api/intern/pflege/aufgaben/981/zuordnung', (route) =>
    route.fulfill({ json: { assignee: null, unavailable: true } })
  );
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  await expect(
    dialog.getByText('Die Personenzuordnung ist nicht verfügbar.', { exact: false })
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Demo Leitung entfernen', exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annehmen', exact: true })).toBeEnabled();
});

test('past proposals are hidden while today, undated proposals and overdue accepted tasks remain', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 9, 11, 12));
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const seed = data.tasks[0];
    data.tasks = ['offen', 'vorschlag', 'erledigt'].flatMap((state, stateIndex) =>
      [
        ['Gestern', '2026-10-10'],
        ['Heute', '2026-10-11'],
        ['Morgen', '2026-10-12'],
        ['Ohne Frist', null],
      ].map(([label, dueDate], index) => ({
        ...seed,
        id: 990 + stateIndex * 4 + index,
        state,
        dueDate,
        title: `${label} ${state}`,
        assignee: data.login,
      }))
    );
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/aufgaben');
  const todayTask = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: 'Heute offen', exact: true }) });
  await expect(todayTask.getByText('Fällig: Heute', { exact: true })).toHaveClass(/text-warning/);
  await expect(todayTask.locator('dl > div')).toHaveCount(3);
  await expect(page.getByText('Fällig: Morgen', { exact: true })).toBeVisible();
  await expect(page.getByText('Fällig: 10.10.2026 · Überfällig', { exact: true })).toBeVisible();
  for (const [label, state] of [
    ['Offen', 'offen'],
    ['Vorschläge', 'vorschlag'],
    ['Erledigt', 'erledigt'],
  ]) {
    await page
      .getByRole('group', { name: 'Aufgabenansicht' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(page.getByRole('heading', { name: `Heute ${state}`, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Morgen ${state}`, exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: `Ohne Frist ${state}`, exact: true })
    ).toBeVisible();
    if (state === 'vorschlag')
      await expect(
        page.getByRole('heading', { name: `Gestern ${state}`, exact: true })
      ).toHaveCount(0);
    else
      await expect(
        page.getByRole('heading', { name: `Gestern ${state}`, exact: true })
      ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  for (const state of ['offen', 'vorschlag', 'erledigt']) {
    await expect(page.getByRole('heading', { name: `Heute ${state}`, exact: true })).toBeVisible();
    if (state === 'vorschlag')
      await expect(
        page.getByRole('heading', { name: `Gestern ${state}`, exact: true })
      ).toHaveCount(0);
    else
      await expect(
        page.getByRole('heading', { name: `Gestern ${state}`, exact: true })
      ).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
  await page.goto('/leitendenbereich');
  const tasks = page.getByRole('region', { name: 'Offene Aufgaben' });
  await expect(tasks.getByRole('link', { name: 'Heute offen', exact: true })).toBeVisible();
  await expect(tasks.getByRole('link', { name: 'Morgen offen', exact: true })).toBeVisible();
  await expect(tasks.getByRole('link', { name: 'Ohne Frist offen', exact: true })).toBeVisible();
  await expect(tasks.getByRole('link', { name: 'Gestern offen', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Vorlagen', exact: true }).click();
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
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await expect(
    dialog.getByText('Personenvorschläge sind gerade nicht verfügbar.', { exact: false })
  ).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('Zuordnung prüfen');
  const person = dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false });
  await person.fill('Hugo');
  await person.press('Tab');
  await expect(
    dialog.getByText(
      'Bitte eine Person auswählen oder den vollständigen Namen bzw. Login eingeben.'
    )
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).fill('Hugo Beispiel');
  await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Hugo Beispiel entfernen', exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
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
  await page.getByLabel('Nur mir zugewiesen').check();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(row.getByText('Alex Beispiel, Bea Beispiel', { exact: false })).toBeVisible();
  await expect(row.getByText('@example.test', { exact: false })).toHaveCount(0);
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await dialog.getByRole('button', { name: 'Bea Beispiel entfernen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByLabel('Nur mir zugewiesen').uncheck();
  await expect(row.getByText('Alex Beispiel', { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
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

test('recognition feedback is local, neutral, dismissible and cleared when continuing work', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/aufgaben/protokolle/**/erkennen', (route) =>
    route.fulfill({ json: { count: 0 } })
  );
  await page.goto('/leitendenbereich/aufgaben?protokoll=prot-7');
  const result = page.getByRole('status', { name: 'Erkennungsergebnis' });
  await expect(result).toBeEmpty();
  const recognize = page.getByRole('button', { name: 'Aufgaben erkennen', exact: true });
  await recognize.click();
  await expect(
    result.getByText('Keine neuen Aufgabenvorschläge gefunden.', { exact: false })
  ).toBeVisible();
  const color = await result.locator('p').evaluate((element) => getComputedStyle(element).color);
  const reference = await page
    .locator('#recognize-heading + p')
    .evaluate((element) => getComputedStyle(element).color);
  expect(color).toBe(reference);
  const box = await result.boundingBox();
  const button = await recognize.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(button!.y + button!.height);
  await result.getByRole('button', { name: 'Erkennungsergebnis ausblenden' }).click();
  await expect(result).toBeEmpty();
  await recognize.click();
  await expect(result.getByText('Keine neuen', { exact: false })).toBeVisible();
  await page.getByText('Aufgaben filtern', { exact: true }).click();
  await page.getByLabel('Nur mir zugewiesen').check();
  await expect(result).toBeEmpty();
  await recognize.click();
  await expect(result.getByText('Keine neuen', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await expect(result).toBeEmpty();
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.unroute('**/api/intern/pflege/aufgaben/protokolle/**/erkennen');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/intern/pflege/aufgaben/protokolle/**/erkennen', async (route) => {
    await gate;
    await route.fulfill({ json: { count: 5 } });
  });
  await recognize.click();
  await expect(
    page.getByRole('button', { name: 'Wird verarbeitet …', exact: true })
  ).toHaveAttribute('aria-busy', 'true');
  if (!(await page.getByLabel('Projekt', { exact: true }).isVisible()))
    await page.locator('summary').filter({ hasText: 'Aufgaben filtern' }).click();
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: 'Ohne Projekt' });
  release();
  await expect(recognize).toHaveAttribute('aria-busy', 'false');
  await expect(result).toBeEmpty();
});
test('mobile task navigation reveals the active tab and protocol choices use newest German dates first', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.route('**/api/intern/pflege/protokolle', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const source = data.items.find((item: { status: string }) =>
      ['Freigegeben', 'Verschickt', 'Archiv'].includes(item.status)
    );
    data.items = [
      {
        ...source,
        id: 'older-source',
        title: 'Leitendenrunde alt',
        date: '2026-09-01',
        changedSinceApproval: false,
      },
      {
        ...source,
        id: 'newer-source',
        title: 'Leitendenrunde neu',
        date: '2026-10-12',
        changedSinceApproval: false,
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/aufgaben');
  const tabs = page.getByRole('group', { name: 'Aufgabenansicht' });
  const openTab = tabs.getByRole('button', { name: 'Offen', exact: true });
  const initialWidth = (await openTab.boundingBox())!.width;
  await tabs.getByRole('button', { name: 'Erledigt', exact: true }).click();
  expect((await openTab.boundingBox())!.width).toBeCloseTo(initialWidth, 1);
  await expect(openTab).toContainText(/Offen.*\(\d+\)/);
  await page.keyboard.press('Tab');
  await page.locator('main').evaluate((element) => element.focus());
  await expect(page.locator('main')).not.toHaveCSS('box-shadow', 'none');
  await expect(openTab).toHaveAccessibleDescription(/\d+ Eintr/);
  await expect(page.locator('main')).toHaveCSS('outline-style', 'none');
  const reveal = tabs.getByRole('button', { name: 'Vorlagen', exact: true });
  await reveal.click();
  await expect(reveal).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => {
      const strip = await tabs.boundingBox();
      const option = await reveal.boundingBox();
      return option!.x >= strip!.x - 1 && option!.x + option!.width <= strip!.x + strip!.width + 1;
    })
    .toBe(true);
  await expect(tabs.locator('..').locator('.tab-fade-left')).toBeVisible();
  await tabs.getByRole('button', { name: 'Vorschläge', exact: true }).click();
  const protocol = page.getByLabel('Protokoll', { exact: true });
  await expect(page.getByText('Wähle zuerst ein Protokoll.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aufgaben erkennen', exact: true })).toBeDisabled();
  await expect(protocol.locator('option').nth(1)).toHaveText('12. Okt. 2026 · Leitendenrunde neu');
  await expect(protocol.locator('option').nth(2)).toHaveText('1. Sept. 2026 · Leitendenrunde alt');
  await page.getByText('Aufgaben filtern', { exact: true }).click();
  const filters = page.getByRole('group', { name: 'Aufgabenfilter' });
  const own = filters.getByText('Nur mir zugewiesen', { exact: true });
  expect((await own.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await own.click();
  await expect(page.getByLabel('Nur mir zugewiesen')).toBeChecked();
  const create = page.getByRole('button', { name: 'Aufgabe anlegen', exact: true });
  await expect(create).toHaveClass(/btn-primary/);
  expect(
    await page.locator('body').evaluate((element) => getComputedStyle(element, '::before').display)
  ).toBe('none');
  await expect(
    page.getByText('Wähle ein Protokoll und tippe auf Aufgaben erkennen.', { exact: true })
  ).toBeVisible();
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
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Aufgabe', exact: true })
    .getByLabel('Titel', { exact: true })
    .fill(title);
  await page
    .getByRole('dialog', { name: 'Aufgabe', exact: true })
    .getByRole('button', { name: 'Speichern', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Aufgabe', exact: true })).not.toBeVisible();
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Aufgabe', exact: true });
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
  await row.getByRole('button', { name: 'Löschen', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Aufgabe löschen', exact: true });
  await expect(deletion).toContainText(title);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `/tmp/phoenix-app-delete-${testInfo.project.name}.png` });
  await deletion.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(deletes).toBe(0);
  await expect(row.getByRole('button', { name: 'Löschen', exact: true })).toBeFocused();
  await row.getByRole('button', { name: 'Löschen', exact: true }).click();
  await deletion.press('Escape');
  expect(deletes).toBe(0);
  await row.getByRole('button', { name: 'Löschen', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Aufgabe anlegen', exact: true })).toBeFocused();
  expect(deletes).toBe(2);
});

test('projects can be deleted with app confirmation while their tasks survive without a project', async ({
  page,
}, testInfo) => {
  const title = `Löschprojekt ${testInfo.project.name}`;
  const taskTitle = `Erhaltene Aufgabe ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Titel', { exact: true }).fill(title);
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await editor.getByLabel('Titel', { exact: true }).fill(taskTitle);
  await editor.getByLabel('Projekt', { exact: false }).selectOption({ label: title });
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(row).toContainText('1 offene Aufgabe');
  await page.getByRole('button', { name: 'Offen', exact: true }).click();
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: title });
  await page.getByRole('button', { name: 'Projekte', exact: true }).click();
  await row.getByRole('button', { name: 'Projekt löschen', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Projekt löschen', exact: true });
  await expect(deletion).toContainText('Die Aufgaben bleiben erhalten');
  await expectNoHorizontalOverflow(page);
  await deletion.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Projekt löschen', exact: true }).click();
  await deletion.getByRole('button', { name: 'Projekt löschen', exact: true }).click();
  await expect(deletion).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Offen', exact: true }).click();
  const task = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) });
  await expect(task).toContainText('Ohne Projekt');
  await expect(page.getByLabel('Projekt', { exact: true })).toHaveValue('alle');
  await task.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(
    editor.getByLabel('Projekt', { exact: false }).locator('option', { hasText: title })
  ).toHaveCount(0);
});

test('new project ideas are reviewed with the task and created only with explicit confirmation', async ({
  page,
}, testInfo) => {
  const title = `Winteridee ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Vorschläge', exact: true }).click();
  await page
    .getByLabel('Protokoll', { exact: true })
    .selectOption(testInfo.project.name === 'mobile' ? 'prot-8' : 'prot-5');
  await page.getByRole('button', { name: 'Aufgaben erkennen', exact: true }).click();
  const sourceId = testInfo.project.name === 'mobile' ? 'prot-8' : 'prot-5';
  const row = page
    .locator('li')
    .filter({ has: page.locator(`a[href="/leitendenbereich/protokolle#protokoll-${sourceId}"]`) });
  await expect(row).toContainText('Projektvorschlag: Winteraktion');
  await row.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Aufgabenvorschlag prüfen', exact: true });
  const consent = editor.getByRole('checkbox', {
    name: 'Neues Projekt anlegen und Aufgabe zuordnen',
  });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await editor.getByLabel('Name des neuen Projekts', { exact: true }).fill(title);
  await expect(editor.getByRole('combobox', { name: /^Projekt/ })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `/tmp/phoenix-project-idea-${testInfo.project.name}.png` });
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Änderungen verwerfen?' })
    .getByRole('button', { name: 'Änderungen verwerfen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Projekte', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Vorschläge', exact: true }).click();
  await row.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  await expect(consent).not.toBeChecked();
  await consent.check();
  await editor.getByLabel('Name des neuen Projekts', { exact: true }).fill(title);
  await editor.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Projekte', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Offen', exact: true }).click();
  await expect(row).toContainText(title);
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('checkbox', { name: 'Neues Projekt anlegen und Aufgabe zuordnen' })
  ).toHaveCount(0);
});
