import type { Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';

/**
 * The minutes and the module Aufgaben (#277, step 3): projects at agenda items, tasks created
 * on approval and the open tasks at the top of the next minutes.
 */

// Tasks from approved minutes would put „Offene Aufgaben“ at the top of minutes in other files
test.afterEach(async ({ page }) => {
  await page.request.post('/api/__mock/aufgaben/reset');
});

async function createProtokoll(page: Page, title: string): Promise<void> {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('textbox', { name: 'Tagesordnung' })).toBeVisible();
}

async function approveOwn(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  const approve = page.getByRole('dialog', { name: `„${title}“ freigeben?` });
  await expect(approve).toContainText('eine Aufgabe im Modul Aufgaben angelegt');
  await approve.getByRole('checkbox', { name: /ohne zweite Person/ }).check();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve).toBeHidden();
}

test('tasks of approved minutes become tasks and come back as open tasks', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Aufgaben');
  // Without tasks from earlier minutes the agenda starts as before
  await expect(page.getByRole('region', { name: /^1\. Stufenberichte/ })).toBeVisible();

  const planung = page.getByRole('region', { name: /^3\. Planung/ });
  await planung.getByRole('button', { name: 'Projekt verknüpfen' }).click();
  await planung.getByLabel('Projekt für Punkt 3.').selectOption({ label: 'Herbstlager' });
  await expect(planung.getByText('Projekt: Herbstlager')).toBeVisible();
  // The open task of the project is shown and can be ticked
  const projektAufgaben = planung.getByRole('list', {
    name: 'Offene Aufgaben im Projekt „Herbstlager“',
  });
  await expect(projektAufgaben.getByText('Küche vorbereiten')).toBeVisible();

  await planung.getByRole('button', { name: '+ Aufgabe' }).click();
  await planung.getByLabel('Aufgabe', { exact: true }).fill('Zelte zählen');
  await planung.getByLabel('Fällig', { exact: true }).fill('2026-11-03');
  await expect(planung.getByText(/werden daraus Aufgaben im Modul Aufgaben/)).toBeVisible();
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  await approveOwn(page, 'Leitendenrunde Aufgaben');
  await expect(page.getByText(/Eine Aufgabe im Modul Aufgaben angelegt\./).first()).toBeVisible();
  const review = page.getByRole('region', { name: 'Review und Versand' });
  await expect(review).toContainText('Bei der Freigabe wurde eine Aufgabe im Modul Aufgaben');
  // The read view and the PDF show the project of the item
  await expect(page.getByText('Projekt: Herbstlager')).toBeVisible();

  // The task is in the module Aufgaben, in the project, with the item it came from
  await page.goto('/leitendenbereich/aufgaben');
  const card = page.locator('li').filter({
    has: page.getByRole('heading', { name: 'Zelte zählen', exact: true }),
  });
  await expect(card.getByRole('link', { name: 'Protokoll' })).toBeVisible();
  await expect(card).toContainText('Punkt 3. Planung');
  await expect(card).toContainText('Herbstlager');

  // The next minutes start with it
  await createProtokoll(page, 'Leitendenrunde Danach');
  const offene = page.getByRole('region', { name: /^1\. Offene Aufgaben/ });
  const list = offene.getByRole('list', { name: 'Offene Aufgaben aus früheren Protokollen' });
  await expect(list.getByText('Zelte zählen')).toBeVisible();
  await expect(list).not.toContainText('Küche vorbereiten');
  await expectNoHorizontalOverflow(page);

  const box = list.getByRole('checkbox', { name: /Zelte zählen/ });
  await box.check();
  await expect(list.getByText(/^Erledigt/)).toBeVisible();
  await expect(
    offene.getByText('Häkchen werden sofort im Modul Aufgaben gespeichert.')
  ).toBeVisible();
  await expect
    .poll(async () => {
      const data = await (await page.request.get('/api/intern/pflege/aufgaben')).json();
      return data.tasks.find((task: { title: string }) => task.title === 'Zelte zählen')?.state;
    })
    .toBe('erledigt');
  // The minutes keep that it was done in this meeting
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  await expect(
    page.getByRole('table', { name: 'Offene Aufgaben zu Punkt 1.' }).getByRole('row', {
      name: /Erledigt.*Zelte zählen/,
    })
  ).toBeVisible();
});

test('an item from an Aktion suggests creating its project', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Aktion');
  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesordnungspunkt aus einer Aktion' });
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();

  const punkt = page.getByRole('region', { name: /^5\. Pfadi-Winterlager/ });
  await punkt.getByRole('button', { name: 'Projekt für die Aktion anlegen' }).click();
  await expect(punkt.getByText('Projekt: Pfadi-Winterlager auf der Hütte')).toBeVisible();
  await expect(
    punkt.getByText(
      'Aufgaben dieses Punkts landen bei der Freigabe im Projekt „Pfadi-Winterlager auf der Hütte“.'
    )
  ).toBeVisible();

  // The next item from the same Aktion is offered the existing project
  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();
  const zweiter = page.getByRole('region', { name: /^6\. Pfadi-Winterlager/ });
  await zweiter
    .getByRole('button', { name: 'Mit Projekt „Pfadi-Winterlager auf der Hütte“ verknüpfen' })
    .click();
  await expect(zweiter.getByText('Projekt: Pfadi-Winterlager auf der Hütte')).toBeVisible();
  await zweiter.getByRole('button', { name: 'Projekt lösen' }).click();
  await expect(zweiter.getByText('Projekt: Pfadi-Winterlager auf der Hütte')).toHaveCount(0);
});

test('approving right after a tick waits for it, so the minutes show it as done', async ({
  page,
}) => {
  await createProtokoll(page, 'Leitendenrunde Langsam');
  const planung = page.getByRole('region', { name: /^3\. Planung/ });
  await planung.getByRole('button', { name: 'Projekt verknüpfen' }).click();
  await planung.getByLabel('Projekt für Punkt 3.').selectOption({ label: 'Herbstlager' });
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  // The answer to the tick is slow; the approval starts before it arrives
  await page.route('**/api/intern/pflege/protokoll-editor-aufgaben/*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await planung.getByRole('checkbox', { name: /Küche vorbereiten/ }).check();
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  const approve = page.getByRole('dialog', { name: '„Leitendenrunde Langsam“ freigeben?' });
  await approve.getByRole('checkbox', { name: /ohne zweite Person/ }).check();
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve).toBeHidden();
  await page.unroute('**/api/intern/pflege/protokoll-editor-aufgaben/*');
  await expect(
    page.getByRole('table', { name: 'Offene Aufgaben zu Punkt 3.' }).getByRole('row', {
      name: /Erledigt.*Küche vorbereiten/,
    })
  ).toBeVisible();
});

test('approving while a project is being created waits for the link', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Projekt langsam');
  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesordnungspunkt aus einer Aktion' });
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();
  const punkt = page.getByRole('region', { name: /^5\. Pfadi-Winterlager/ });
  await punkt.getByRole('button', { name: '+ Aufgabe' }).click();
  await punkt.getByLabel('Aufgabe', { exact: true }).fill('Hütte buchen');
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  await page.route('**/api/intern/pflege/aufgaben/projekte', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await punkt.getByRole('button', { name: 'Projekt für die Aktion anlegen' }).click();
  await approveOwn(page, 'Leitendenrunde Projekt langsam');
  await page.unroute('**/api/intern/pflege/aufgaben/projekte');
  await expect(page.getByText('Projekt: Pfadi-Winterlager auf der Hütte')).toBeVisible();

  const data = await (await page.request.get('/api/intern/pflege/aufgaben')).json();
  const project = data.projects.find(
    (p: { title: string }) => p.title === 'Pfadi-Winterlager auf der Hütte'
  );
  const task = data.tasks.find((t: { title: string }) => t.title === 'Hütte buchen');
  expect(task.projectId).toBe(project.id);
});
