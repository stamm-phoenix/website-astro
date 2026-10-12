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
  await row(open).getByRole('button', { name: 'Erledigt', exact: true }).click();
  await expect(row(open)).toHaveCount(0);
  await expect(row(done)).toBeVisible();
  await row(done).getByRole('button', { name: 'Wieder öffnen', exact: true }).click();
  await expect(row(open)).toBeVisible();
  await page.getByLabel('Nur meinem Login zugewiesen', { exact: true }).check();
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
  await expect(dialog.getByLabel('Zuständigkeit', { exact: false })).toHaveValue(
    'leitung@example.test'
  );
  await expect(dialog.getByText('Tag automatisch zugeordnet:', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Offen', exact: true }).click();
  await page.getByLabel('Nur meinem Login zugewiesen', { exact: true }).check();
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
  page.once('dialog', (prompt) => void prompt.accept());
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.unroute('**/api/intern/pflege/aufgaben/981/zuordnung');
  await page.route('**/api/intern/pflege/aufgaben/981/zuordnung', (route) =>
    route.fulfill({ json: { assignee: null, unavailable: true } })
  );
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  await expect(
    dialog.getByText('Die Login-Zuordnung ist nicht verfügbar.', { exact: false })
  ).toBeVisible();
  await expect(dialog.getByLabel('Zuständigkeit', { exact: false })).toHaveValue('Demo Leitung');
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
  await expect(
    dialog.getByRole('option', { name: `Hugo Beispiel <${login}>`, exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Hugo Anders/ })).toBeVisible();
  await assignee.press('ArrowDown');
  await assignee.press('Enter');
  await expect(assignee).toHaveValue(login);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Titel', { exact: true }).fill(title);
  const request = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith('/intern/pflege/aufgaben')
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await request).postDataJSON().assignee).toBe(login);
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('Nur meinem Login zugewiesen').check();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Bestehende Namenszuweisung', exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto('/leitendenbereich');
  const tasks = page.getByRole('region', { name: 'Offene Aufgaben' });
  await expect(tasks.getByText('2 deinem Login zugewiesen', { exact: false })).toBeVisible();
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
  const option = dialog.getByRole('option', { name: `Hugo Beispiel <${login}>`, exact: true });
  if (testInfo.project.name === 'mobile') await option.tap();
  else await option.click();
  await expect(dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false })).toHaveValue(
    login
  );
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
  await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).fill('Hugo Beispiel');
  await expect(dialog.getByText(`Wird ${login} zugewiesen.`, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
});
