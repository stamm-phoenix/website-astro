import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { Page } from '@playwright/test';

// The agenda as one document in the formatting editor (#277, Stufe 1).

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/__mock/einstellungen/reset');
});

/** Creates minutes and waits for the document; returns the URL of their page. */
async function createProtokoll(page: Page, title: string): Promise<string> {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('textbox', { name: 'Tagesordnung' })).toBeVisible();
  return page.url();
}

/** Number and title of every item, in the order of the document. */
function reihenfolge(page: Page): () => Promise<string[]> {
  return () =>
    page
      .locator('[data-punkt-kopf]')
      .evaluateAll((rows) =>
        rows.map(
          (row) =>
            `${row.querySelector('.nummer')?.textContent?.trim()} ${row.querySelector('.punkt-titel')?.textContent?.trim()}`
        )
      );
}

/** The minutes as the server holds them, to wait for the autosave before reloading. */
function gespeichert(page: Page): () => Promise<string> {
  return async () => {
    const id = new URL(page.url()).searchParams.get('id');
    const detail = await (await page.request.get(`/api/intern/protokoll-editor/${id}`)).json();
    return JSON.stringify(detail.inhalt.punkte);
  };
}

/** The item the cursor is in, by its label. */
function aktiverPunkt(page: Page): () => Promise<string | null> {
  return () =>
    page.evaluate(() => {
      const node = document.getSelection()?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest('[data-punkt]')?.getAttribute('aria-label') ?? null;
    });
}

test('Enter and Backspace move through the items like in a document', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Dokument');
  await expectNoHorizontalOverflow(page);
  const dokument = page.getByRole('textbox', { name: 'Tagesordnung' });
  const reflexion = page.getByRole('region', { name: /^2\. / });

  // Enter in the title goes to the text; Enter in an empty last line starts the next item
  await reflexion.locator('.punkt-titel').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Stammestag war gut');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(aktiverPunkt(page)).toBe('3. Tagesordnungspunkt');
  await page.keyboard.type('Zeltlager');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Noch offen: Platz');
  await expect
    .poll(reihenfolge(page))
    .toEqual([
      '1. Stufenberichte',
      '1a. Wölflinge',
      '1b. Jungpfadfinder',
      '1c. Pfadfinder',
      '1d. Rover',
      '1e. StaVos',
      '2. Reflexion',
      '3. Zeltlager',
      '4. Planung',
      '5. Sonstiges',
    ]);
  // The empty line in Reflexion went with the new item
  await expect(reflexion.locator('.punkt-text')).toHaveText('Stammestag war gut');

  // Backspace in an empty item removes it and goes back to the item before
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(aktiverPunkt(page)).toBe('4. Tagesordnungspunkt');
  await page.keyboard.press('Backspace');
  await expect.poll(aktiverPunkt(page)).toBe('3. Zeltlager');
  await expect(
    page.getByRole('region', { name: /^3\. Zeltlager/ }).locator('.punkt-text')
  ).toHaveText('Noch offen: Platz');
  // Backspace at the start of a text goes to the title, never into the item before
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(aktiverPunkt(page)).toBe('3. Zeltlager');
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.className))
    .toContain('punkt-titel');
  // An item with a title stays, Backspace at its start does nothing
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('region', { name: /^3\. Zeltlager/ })).toBeVisible();

  // Everything is saved and comes back
  await expect.poll(gespeichert(page)).toContain('Noch offen: Platz');
  await page.reload();
  await expect(dokument).toBeVisible();
  await expect(
    page.getByRole('region', { name: /^3\. Zeltlager/ }).locator('.punkt-text')
  ).toHaveText('Noch offen: Platz');
  await expect(reflexion.locator('.punkt-text')).toHaveText('Stammestag war gut');
});

test('a selection across items cannot delete them, the buttons can', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Löschen');
  const reflexion = page.getByRole('region', { name: /^2\. / });
  await reflexion.locator('.punkt-text').click();
  await page.keyboard.type('Wichtig');
  // Select everything and delete: the texts go, the items stay
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect.poll(reihenfolge(page)).toHaveLength(9);
  await expect(reflexion.locator('.punkt-text')).toHaveText('Wichtig');
  await expect(page.getByRole('region', { name: /^3\. Planung/ })).toBeVisible();

  // The button asks for an item with content and deletes it
  await reflexion.getByRole('button', { name: 'Punkt 2. löschen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Punkt 2. „Reflexion“ löschen?' });
  await expect(dialog).toContainText('hat Inhalt');
  await dialog.getByRole('button', { name: 'Löschen' }).click();
  await expect
    .poll(reihenfolge(page))
    .toEqual([
      '1. Stufenberichte',
      '1a. Wölflinge',
      '1b. Jungpfadfinder',
      '1c. Pfadfinder',
      '1d. Rover',
      '1e. StaVos',
      '2. Planung',
      '3. Sonstiges',
    ]);
  // An empty item goes without asking, and undo brings it back
  await page.getByRole('button', { name: 'Punkt 3. löschen' }).click();
  await expect.poll(reihenfolge(page)).toHaveLength(7);
  await page
    .getByRole('toolbar', { name: 'Formatierung' })
    .getByRole('button', { name: 'Rückgängig' })
    .click();
  await expect.poll(reihenfolge(page)).toHaveLength(8);
});

test('the handle moves items with the keyboard and by dragging', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Reihenfolge im Dokument');
  await page.getByRole('button', { name: /^1\. Stufenberichte verschieben/ }).press('ArrowUp');
  await expect(
    page.getByRole('status').filter({ hasText: '„Stufenberichte“ steht schon ganz oben.' })
  ).toBeVisible();
  await page.getByRole('button', { name: /^1e\. StaVos verschieben/ }).press('ArrowLeft');
  await expect(
    page.getByRole('status').filter({ hasText: '„StaVos“ ist jetzt Punkt 2.' })
  ).toBeVisible();
  await page.getByRole('button', { name: /^3\. Reflexion verschieben/ }).press('ArrowRight');
  await expect.poll(reihenfolge(page)).toContain('2a. Reflexion');
  // The arrow buttons in the title row move too
  await page.getByRole('button', { name: 'Punkt 4. nach oben' }).click();
  await expect
    .poll(reihenfolge(page))
    .toEqual([
      '1. Stufenberichte',
      '1a. Wölflinge',
      '1b. Jungpfadfinder',
      '1c. Pfadfinder',
      '1d. Rover',
      '2. StaVos',
      '2a. Reflexion',
      '3. Sonstiges',
      '4. Planung',
    ]);

  // Dragging „Planung“ up and to the right below „Reflexion“ makes it a sub-item of „StaVos“
  const griff = page.getByRole('button', { name: /^4\. Planung verschieben/ });
  // In the middle of the window, so the page does not scroll along while dragging
  await griff.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  await expect(griff).toBeInViewport();
  const start = (await griff.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 6);
  await page.mouse.move(x, y - 12);
  // While dragging, the items shrink to their title rows
  await expect(page.getByRole('region', { name: /^1a\. / }).locator('.punkt-text')).toBeHidden();
  // Towards the top of the row „3. Sonstiges“, measured anew with every step: the page may
  // scroll along while the pointer is near its edge, on a phone above all
  const zielZeile = page.locator('[data-punkt-kopf]').nth(7);
  for (let step = 1; step <= 10; step++) {
    const ziel = (await zielZeile.boundingBox())!;
    await page.mouse.move(x + step * 6, y - 12 + ((ziel.y + 4 - y + 12) * step) / 10);
  }
  await page.waitForTimeout(150);
  const ziel = (await zielZeile.boundingBox())!;
  await page.mouse.move(x + 60, ziel.y + 4);
  await expect(page.getByText('als Unterpunkt von 2. StaVos')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole('region', { name: /^1a\. / }).locator('.punkt-text')).toBeVisible();
  await expect
    .poll(reihenfolge(page))
    .toEqual([
      '1. Stufenberichte',
      '1a. Wölflinge',
      '1b. Jungpfadfinder',
      '1c. Pfadfinder',
      '1d. Rover',
      '2. StaVos',
      '2a. Reflexion',
      '2b. Planung',
      '3. Sonstiges',
    ]);
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();
});

test('tasks, dates, sub-items and an Aktion live in the document and are kept', async ({
  page,
}) => {
  await createProtokoll(page, 'Leitendenrunde Bausteine');
  const reflexion = page.getByRole('region', { name: /^2\. / });
  await reflexion.getByRole('button', { name: '+ Aufgabe' }).click();
  const aufgabe = reflexion.getByRole('list', { name: 'Aufgaben zu Punkt 2.' });
  await aufgabe.getByLabel('Aufgabe', { exact: true }).fill('Zelte zählen');
  await aufgabe.getByLabel('Fällig', { exact: true }).fill('2026-11-03');
  await reflexion.getByRole('button', { name: '+ Termin' }).click();
  await reflexion.getByLabel('Termin', { exact: true }).fill('Elternabend');
  await reflexion.getByRole('button', { name: '+ Unterpunkt' }).click();
  await expect.poll(aktiverPunkt(page)).toBe('2a. Tagesordnungspunkt');
  await page.keyboard.type('Rückmeldungen');
  await expect(reflexion.getByRole('list', { name: 'Aufgaben zu Punkt 2.' })).toBeVisible();

  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesordnungspunkt aus einer Aktion' });
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();
  const winterlager = page.getByRole('region', { name: /^5\. Pfadi-Winterlager/ });
  await expect(winterlager).toContainText('Aktion, ');
  await expect.poll(aktiverPunkt(page)).toMatch(/^5\. Pfadi-Winterlager/);
  await page.keyboard.type('Anmeldungen laufen');

  await expect.poll(gespeichert(page)).toContain('Anmeldungen laufen');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Tagesordnung' })).toBeVisible();
  await expect(reflexion.getByLabel('Aufgabe', { exact: true })).toHaveValue('Zelte zählen');
  await expect(reflexion.getByLabel('Fällig', { exact: true })).toHaveValue('2026-11-03');
  await expect(reflexion.getByLabel('Termin', { exact: true })).toHaveValue('Elternabend');
  await expect(page.getByRole('region', { name: '2a. Rückmeldungen' })).toBeVisible();
  await expect(winterlager.locator('.punkt-text')).toHaveText('Anmeldungen laufen');
  await winterlager.getByRole('button', { name: /Verknüpfung mit der Aktion .* lösen/ }).click();
  await expect(winterlager).not.toContainText('Aktion, ');

  // The reading view shows it all
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  const lese = page.getByRole('dialog', { name: 'Leseansicht' });
  await expect(lese.getByRole('region', { name: '2. Reflexion' })).toContainText('Zelte zählen');
  await expect(lese.getByRole('region', { name: '2. Reflexion' })).toContainText('Elternabend');
  await expect(lese.getByRole('region', { name: '2a. Rückmeldungen' })).toBeVisible();
});

test('switching to Markdown and back keeps the texts and the blocks', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Umschalten');
  const reflexion = page.getByRole('region', { name: /^2\. / });
  await reflexion.locator('.punkt-text').click();
  await page.keyboard.type('Erstens ');
  await page
    .getByRole('toolbar', { name: 'Formatierung' })
    .getByRole('button', { name: 'Fett' })
    .click();
  await page.keyboard.type('wichtig');
  await reflexion.getByRole('button', { name: '+ Aufgabe' }).click();
  await reflexion.getByLabel('Aufgabe', { exact: true }).fill('Nachfragen');
  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Markdown' }).click();
  await expect(page.getByLabel('Text zu Punkt 2.')).toHaveValue('Erstens **wichtig**');
  await expect(page.getByLabel('Aufgabe', { exact: true })).toHaveValue('Nachfragen');
  await page.getByLabel('Text zu Punkt 2.').fill('Erstens **wichtig**\n\n- [ ] Zweitens');
  await modus.getByRole('button', { name: 'Formatiert' }).click();
  await expect(reflexion.locator('.punkt-text strong')).toHaveText('wichtig');
  await expect(reflexion.locator('.punkt-text').getByRole('checkbox')).toHaveCount(1);
  await expect(reflexion.getByLabel('Aufgabe', { exact: true })).toHaveValue('Nachfragen');
});
