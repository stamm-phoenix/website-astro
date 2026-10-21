import { prepareTaskTest } from './aufgaben-helpers';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { taskStatus, taskFilters, taskPage } from './aufgaben-helpers';
test.beforeEach(async ({ page }, testInfo) => {
  await prepareTaskTest(page, testInfo.project.name);
});
test('create a project and template, apply once, assign and complete a task', async ({
  page,
}, testInfo) => {
  const projectTitle = `Testlager ${testInfo.project.name}`;
  const templateTitle = `Testvorlage ${testInfo.project.name}`;
  const taskTitle = `Testzelte prüfen ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Projekte\b/ })
    .click();
  await page.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel', { exact: true }).fill(projectTitle);
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Vorlagen\b/ })
    .click();
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await dialog.getByLabel('Titel', { exact: true }).fill(templateTitle);
  await dialog.getByLabel('Aufgabentitel').fill(taskTitle);
  await dialog.getByLabel('Tage vor der Aktion').fill('7');
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await expect(dialog).not.toBeVisible();
  await taskPage(page);
  await page.getByRole('button', { name: 'Checkliste aus Vorlage', exact: true }).click();
  await dialog.getByLabel('Projekt', { exact: true }).selectOption({ label: projectTitle });
  await dialog.getByLabel('Vorlage', { exact: true }).selectOption({ label: templateTitle });
  await dialog.getByLabel('Datum der Aktion').fill('01.11.2026');
  const checklistRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith('/intern/pflege/aufgaben/checkliste')
  );
  await dialog.getByRole('button', { name: 'Aufgaben anlegen', exact: true }).click();
  const checklistBody = (await checklistRequest).postDataJSON();
  expect(typeof checklistBody.projectId).toBe('number');
  expect(typeof checklistBody.templateId).toBe('number');
  await expect(dialog).not.toBeVisible();
  await taskStatus(page, 'Offen');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) });
  await expect(row.getByText('Fällig: 25.10.2026', { exact: false })).toBeVisible();
  await row.getByRole('heading').getByRole('button').click();
  for (const remove of await dialog.getByRole('button', { name: /entfernen$/ }).all())
    await remove.click();
  await dialog.getByLabel('Zuständigkeit', { exact: false }).fill('bea@example.test');
  const taskRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' && /\/intern\/pflege\/aufgaben\/\d+$/.test(request.url())
  );
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  expect(typeof (await taskRequest).postDataJSON().projectId).toBe('number');
  await expect(dialog).not.toBeVisible();
  await expect(row.getByText('Bea Beispiel', { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await expect(row).toHaveCount(0);
  await taskStatus(page, 'Erledigt');
  await expect(row).toBeVisible();
  await taskPage(page);
  await page.getByRole('button', { name: 'Checkliste aus Vorlage', exact: true }).click();
  await dialog.getByLabel('Projekt', { exact: true }).selectOption({ label: projectTitle });
  await dialog.getByLabel('Vorlage', { exact: true }).selectOption({ label: templateTitle });
  await dialog.getByRole('button', { name: 'Aufgaben anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText('Diese Vorlage wurde für das Projekt bereits angewendet.').first()
  ).toBeVisible();
  await expect(row).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
test('task views, status filters and administration pages are separate and protocols use newest dates first', async ({
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
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('link', { name: 'Zum Inhalt springen', exact: true }).focus();
  await page.keyboard.press('Enter');
  // Past the sidebar: the next Tab goes to the module, not to the list of areas
  const content = page.locator('#staff-content');
  await expect(content).toBeFocused();
  await expect(content).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(
      () => !document.querySelector('.staff-sidebar')?.contains(document.activeElement)
    )
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector('#staff-content')!.getBoundingClientRect();
        const header = document.querySelector('body > header')!.getBoundingClientRect();
        return content.top - header.bottom;
      })
    )
    .toBeGreaterThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Aufgabe anlegen', exact: true })).toHaveClass(
    /btn-primary/
  );
  await expect(
    page
      .getByRole('group', { name: 'Darstellung', exact: true })
      .getByRole('button', { name: 'Liste', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page
      .getByRole('group', { name: 'Status', exact: true })
      .getByRole('button', { name: 'Offen', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Aufgabenfilter' })).not.toBeVisible();
  await expect(page.getByText('Filter (0 aktiv)', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Status', exact: true }).getByRole('button')
  ).toHaveCount(3);
  await taskStatus(page, 'Erledigt');
  await page.keyboard.press('Tab');
  await page.locator('main').evaluate((element) => element.focus());
  await expect(page.locator('main')).toHaveCSS('outline-style', 'solid');
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung' })
    .getByRole('link', { name: /^Vorlagen\b/ })
    .click();
  await expect(page).toHaveURL(/\/aufgaben\/vorlagen$/);
  await expect(page.getByRole('heading', { name: 'Vorlagen', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Darstellung' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Status' })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung' })
    .getByRole('link', { name: /^Vorschläge\b/ })
    .click();
  await expect(page).toHaveURL(/\/aufgaben\/vorschlaege$/);
  const protocol = page.getByLabel('Protokoll', { exact: true });
  await expect(page.getByText('Wähle zuerst ein Protokoll.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aufgaben erkennen', exact: true })).toBeDisabled();
  await expect(protocol.locator('option').nth(1)).toContainText(
    '12. Okt. 2026 · Leitendenrunde neu'
  );
  await expect(protocol.locator('option').nth(2)).toContainText(
    '1. Sept. 2026 · Leitendenrunde alt'
  );
  await taskFilters(page);
  const filters = page.getByRole('group', { name: 'Aufgabenfilter' });
  const own = filters.getByText('Nur mir zugewiesen', { exact: true });
  expect((await own.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await own.click();
  await expect(page.getByLabel('Nur mir zugewiesen')).toBeChecked();
  const create = page.getByRole('button', { name: 'Aufgabe anlegen', exact: true });
  await expect(create).toHaveCount(0);
  expect(
    await page.locator('body').evaluate((element) => getComputedStyle(element, '::before').display)
  ).toBe('block');
  await expect(
    page.getByText('Wähle ein Protokoll und tippe auf Aufgaben erkennen.', { exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('projects can be deleted with app confirmation while their tasks survive without a project', async ({
  page,
}, testInfo) => {
  const title = `Löschprojekt ${testInfo.project.name}`;
  const taskTitle = `Erhaltene Aufgabe ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Projekte\b/ })
    .click();
  await page.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Titel', { exact: true }).fill(title);
  await editor
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await expect(editor).not.toBeVisible();
  await taskPage(page);
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await editor.getByLabel('Titel', { exact: true }).fill(taskTitle);
  await editor.getByLabel('Projekt', { exact: false }).selectOption({ label: title });
  await editor
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await expect(editor).not.toBeVisible();
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung' })
    .getByRole('link', { name: /^Projekte\b/ })
    .click();
  await expect(row).toContainText('1 offene Aufgabe');
  await taskStatus(page, 'Offen');
  await taskFilters(page);
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: title });
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Projekte\b/ })
    .click();
  await row.getByRole('button', { name: 'Projekt löschen', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: `Projekt „${title}“ löschen?`, exact: true });
  await expect(deletion).toContainText('Die Aufgaben bleiben erhalten');
  await expectNoHorizontalOverflow(page);
  await deletion.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Projekt löschen', exact: true }).click();
  await deletion.getByRole('button', { name: 'Projekt löschen', exact: true }).click();
  await expect(deletion).not.toBeVisible();
  await expect(row).toHaveCount(0);
  await taskStatus(page, 'Offen');
  const task = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: taskTitle, exact: true }) });
  await expect(task).toContainText('Ohne Projekt');
  await expect(page.getByLabel('Projekt', { exact: true })).toHaveValue('alle');
  await task.getByRole('heading').getByRole('button').click();
  await expect(
    editor.getByLabel('Projekt', { exact: false }).locator('option', { hasText: title })
  ).toHaveCount(0);
});

test('new project ideas are reviewed with the task and created only with explicit confirmation', async ({
  page,
}, testInfo) => {
  const title = `Winteridee ${testInfo.project.name}`;
  await page.goto('/leitendenbereich/aufgaben');
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Vorschläge\b/ })
    .click();
  await expect(page).toHaveURL(/\/aufgaben\/vorschlaege$/);
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
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Projekte\b/ })
    .click();
  await expect(page).toHaveURL(/\/aufgaben\/projekte$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Vorschläge\b/ })
    .click();
  await expect(page).toHaveURL(/\/aufgaben\/vorschlaege$/);
  await row.getByRole('button', { name: 'Prüfen und annehmen', exact: true }).click();
  await expect(consent).not.toBeChecked();
  await consent.check();
  await editor.getByLabel('Name des neuen Projekts', { exact: true }).fill(title);
  await editor.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page
    .getByRole('navigation', { name: 'Planung und Verwaltung', exact: true })
    .getByRole('link', { name: /^Projekte\b/ })
    .click();
  await expect(page).toHaveURL(/\/aufgaben\/projekte$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
  await taskStatus(page, 'Offen');
  await expect(row).toContainText(title);
  await row.getByRole('heading').getByRole('button').click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('checkbox', { name: 'Neues Projekt anlegen und Aufgabe zuordnen' })
  ).toHaveCount(0);
});
