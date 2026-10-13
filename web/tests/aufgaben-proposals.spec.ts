import { prepareTaskTest } from './aufgaben-helpers';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { taskStatus, taskFilters, taskPage } from './aufgaben-helpers';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
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
  await dialog.getByLabel('Fälligkeit', { exact: false }).fill('20.10.2026');
  await dialog.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Aufgaben erkennen', exact: true }).click();
  await expect(
    page.getByText('Keine neuen Aufgabenvorschläge gefunden.', { exact: false }).first()
  ).toBeVisible();
  await taskStatus(page, 'Offen');
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Bea Beispiel', { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page);
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
  await taskStatus(page, 'Alle');
  await page
    .getByRole('group', { name: 'Darstellung', exact: true })
    .getByRole('button', { name: 'Kanban', exact: true })
    .click();
  await expect(page.getByRole('region', { name: /^Vorschläge/ })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung' })
    .getByRole('link', { name: /^Vorschläge\b/ })
    .click();
  await expect(row.getByRole('heading', { name: proposal.title })).toBeVisible();
  await row.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Aufgaben aus Protokollen', exact: true })
  ).toBeFocused();
  await expect(row).toHaveCount(0);
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
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Vorschläge\b/ })
    .click();
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Demo Leitung entfernen', exact: true })
  ).toBeVisible();
  await expect(dialog.getByText('Zuordnungsvorschlag:', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await taskStatus(page, 'Offen');
  await taskFilters(page);
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
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Vorschläge\b/ })
    .click();
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
  await expect(
    page
      .locator('li')
      .filter({ has: page.getByRole('heading', { name: 'Morgen offen', exact: true }) })
      .getByText('Fällig: Morgen', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Fällig: 1 Tag überfällig', { exact: true })).toBeVisible();
  for (const [label, state] of [
    ['Offen', 'offen'],
    ['Vorschläge', 'vorschlag'],
    ['Erledigt', 'erledigt'],
  ]) {
    if (state === 'vorschlag')
      await page
        .getByRole('navigation', { name: 'Planung und Verwaltung' })
        .getByRole('link', { name: /^Vorschläge\b/ })
        .click();
    else await taskStatus(page, label);
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
  await taskStatus(page, 'Alle');
  await page
    .getByRole('group', { name: 'Darstellung', exact: true })
    .getByRole('button', { name: 'Kanban', exact: true })
    .click();
  for (const state of ['offen', 'erledigt']) {
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
  await taskFilters(page);
  await taskFilters(page);
  await page.getByLabel('Nur mir zugewiesen').check();
  await expect(result).toBeEmpty();
  await recognize.click();
  await expect(result.getByText('Keine neuen', { exact: false })).toBeVisible();
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await expect(result).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.goto('/leitendenbereich/aufgaben/vorschlaege?protokoll=prot-7');
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
  if (!(await page.getByLabel('Projekt', { exact: true }).isVisible())) await taskFilters(page);
  await taskFilters(page);
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: 'Ohne Projekt' });
  release();
  await expect(recognize).toHaveAttribute('aria-busy', 'false');
  await expect(result).toBeEmpty();
});

test('directory mapping remains an explicit proposal in card and review dialog', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tasks = [
      {
        ...data.tasks[0],
        state: 'vorschlag',
        dueDate: null,
        sourceId: 'P1',
        sourceVersion: 'v1',
        quote: 'Kathi organisiert das Treffen.',
        suggestedAssigneeName: 'Kathi',
        assignee: 'katharina.muster@stamm-phoenix.de',
        assignees: [{ name: 'Katharina Muster', login: 'katharina.muster@stamm-phoenix.de' }],
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/aufgaben/vorschlaege');
  await expect(
    page.getByText('Zuordnungsvorschlag: Kathi → Katharina Muster', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabenvorschlag prüfen' });
  await expect(
    dialog.getByText('Zuordnungsvorschlag: Kathi → Katharina Muster. Bitte prüfen.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Katharina Muster entfernen', exact: true })
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annehmen', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Katharina Muster entfernen', exact: true }).click();
  await expect(dialog.getByText('Zuordnungsvorschlag:', { exact: false })).toHaveCount(0);
});
