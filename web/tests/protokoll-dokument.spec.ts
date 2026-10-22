import { EDITOR_LOAD_TIMEOUT, test, expect, expectNoHorizontalOverflow } from './fixtures';
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
  await expect(page.getByRole('textbox', { name: 'Tagesordnung' })).toBeVisible({
    timeout: EDITOR_LOAD_TIMEOUT,
  });
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

test('the toolbar sticks on desktop and leaves writing space on phones', async ({
  page,
}, testInfo) => {
  await createProtokoll(page, 'Leitendenrunde Leiste');
  await page.evaluate(() => window.scrollTo(0, 0));
  // Scroll into the agenda so that the header and the status bar stick
  await page.getByRole('region', { name: /^3\. / }).scrollIntoViewIfNeeded();
  const kanten = () =>
    page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const header = rect('body > header');
      const leiste = rect('[data-sticky-top]');
      const toolbar = rect('[role="toolbar"][aria-label="Formatierung"]');
      return {
        header: header ? Math.round(header.top) : null,
        leiste: leiste && header ? Math.round(leiste.top - header.bottom) : null,
        toolbar: leiste && toolbar ? Math.round(toolbar.top - leiste.bottom) : null,
      };
    });
  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('[data-sticky-top]')).not.toHaveCSS('position', 'sticky');
    await expect(page.getByRole('toolbar', { name: 'Formatierung', exact: true })).not.toHaveCSS(
      'position',
      'sticky'
    );
  } else await expect.poll(kanten).toEqual({ header: 0, leiste: 0, toolbar: 0 });
});

test('Backspace at the start of a list first removes the bullet, then goes to the title', async ({
  page,
}) => {
  await createProtokoll(page, 'Leitendenrunde Liste');
  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Einfacher Text (Markdown)' }).click();
  await page.getByLabel('Text zu Punkt 2.').fill('- Eintrag\n- Zwei');
  await page.getByLabel('Text zu Punkt 3.').fill('> Zitat');
  await modus.getByRole('button', { name: 'Formatiert' }).click();
  const feld = () =>
    page.evaluate(() => {
      const node = document.getSelection()?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest('.punkt-titel')
        ? 'titel'
        : element?.closest('.punkt-text')
          ? 'text'
          : '';
    });
  for (const [nummer, erstes] of [
    ['2', 'Eintrag'],
    ['3', 'Zitat'],
  ]) {
    const region = page.getByRole('region', { name: new RegExp(`^${nummer}\\. `) });
    await region.locator('.punkt-titel').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect.poll(feld).toBe('text');
    await page.keyboard.press('Backspace');
    await expect(region.locator('.punkt-text > p').first()).toHaveText(erstes);
    await expect.poll(feld).toBe('text');
    await page.keyboard.press('Backspace');
    await expect.poll(feld).toBe('titel');
    await expect(region.locator('.punkt-text > p').first()).toHaveText(erstes);
  }
  await expect(page.getByRole('region', { name: /^2\. / }).locator('.punkt-text li')).toHaveText([
    'Zwei',
  ]);
});

test('a selection across items cannot delete them, the buttons can', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Löschen');
  const reflexion = page.getByRole('region', { name: /^2\. / });
  await reflexion.locator('.punkt-text').click();
  await page.keyboard.type('Wichtig');
  // Select everything and delete: that would take items with it, so nothing changes
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect.poll(reihenfolge(page)).toHaveLength(9);
  await expect(reflexion.locator('.punkt-text')).toHaveText('Wichtig');
  await expect(page.getByRole('region', { name: /^3\. Planung/ })).toBeVisible();

  // The button asks for an item with content and deletes it
  await reflexion.getByRole('button', { name: 'Punkt 2. löschen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Punkt 2. „Reflexion“ löschen?' });
  await expect(dialog).toContainText('mitgelöscht');
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
  const toolbar = page.getByRole('toolbar', { name: 'Formatierung' });
  await page.getByRole('button', { name: 'Punkt 3. löschen' }).click();
  await expect.poll(reihenfolge(page)).toHaveLength(7);
  await toolbar.getByRole('button', { name: 'Rückgängig' }).click();
  await expect.poll(reihenfolge(page)).toHaveLength(8);

  // Undo also takes back an item that Enter created, redo brings it again
  await page
    .getByRole('region', { name: /^3\. Sonstiges/ })
    .locator('.punkt-titel')
    .click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(aktiverPunkt(page)).toBe('4. Tagesordnungspunkt');
  await toolbar.getByRole('button', { name: 'Rückgängig' }).click();
  await expect.poll(reihenfolge(page)).toHaveLength(8);
  await toolbar.getByRole('button', { name: 'Wiederholen' }).click();
  await expect.poll(reihenfolge(page)).toHaveLength(9);
});

test('the last item is emptied instead of removed', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Letzter Punkt');
  await page.getByRole('button', { name: 'Punkt 1. löschen' }).click();
  await page
    .getByRole('dialog', { name: 'Punkt 1. „Stufenberichte“ löschen?' })
    .getByRole('button', { name: 'Löschen' })
    .click();
  await expect.poll(reihenfolge(page)).toEqual(['1. Reflexion', '2. Planung', '3. Sonstiges']);
  await page.getByRole('button', { name: 'Punkt 1. löschen' }).click();
  await expect.poll(reihenfolge(page)).toEqual(['1. Planung', '2. Sonstiges']);
  await page.getByRole('button', { name: 'Punkt 1. löschen' }).click();
  await expect.poll(reihenfolge(page)).toEqual(['1. Sonstiges']);

  // Select all and delete cannot empty the only item, its task stays
  const sonstiges = page.getByRole('region', { name: /^1\. Sonstiges/ });
  await sonstiges.getByRole('button', { name: '+ Aufgabe' }).click();
  await sonstiges.getByLabel('Aufgabe', { exact: true }).fill('Kasse prüfen');
  await sonstiges.locator('.punkt-text').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect.poll(reihenfolge(page)).toEqual(['1. Sonstiges']);
  await expect(sonstiges.getByLabel('Aufgabe', { exact: true })).toHaveValue('Kasse prüfen');

  // The last item loses its title and content, the place to write stays and has the cursor
  await page.getByRole('button', { name: 'Punkt 1. löschen' }).click();
  await page
    .getByRole('dialog', { name: 'Punkt 1. „Sonstiges“ löschen?' })
    .getByRole('button', { name: 'Löschen' })
    .click();
  await expect.poll(reihenfolge(page)).toEqual(['1. ']);
  await expect(page.getByLabel('Aufgabe', { exact: true })).toHaveCount(0);
  await expect.poll(aktiverPunkt(page)).toBe('1. Tagesordnungspunkt');
  await page.keyboard.type('Neu');
  await expect.poll(reihenfolge(page)).toEqual(['1. Neu']);
  await expect.poll(gespeichert(page)).toContain('"titel":"Neu"');
});

test('a text that is too long gets a warning at its item', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Zu lang');
  const reflexion = page.getByRole('region', { name: /^2\. / });
  await reflexion.locator('.punkt-text').click();
  await page.keyboard.insertText('Lang '.repeat(4001));
  await expect(reflexion.getByRole('alert')).toHaveText(
    /^Der Text ist zu lang \(20\.00\d von 20\.000 Zeichen\) und wird so nicht gespeichert\./
  );
  await expect(page.getByRole('region', { name: /^3\. / }).getByRole('alert')).toBeHidden();
  await expectNoHorizontalOverflow(page);
  // Shortening the text removes the warning
  await reflexion.locator('.punkt-text p').click({ clickCount: 3 });
  await page.keyboard.press('Delete');
  await expect(reflexion.locator('.punkt-text')).toHaveText('');
  await expect(reflexion.getByRole('alert')).toBeHidden();
});

test('the arrow buttons keep the cursor in the moved item', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Pfeile');
  const planung = page.getByRole('region', { name: /Planung/ });
  await planung.locator('.punkt-text').click();
  await page.keyboard.type('Plan');
  await page.getByRole('button', { name: 'Punkt 3. nach unten' }).click();
  await expect.poll(reihenfolge(page)).toContain('4. Planung');
  await expect.poll(aktiverPunkt(page)).toBe('4. Planung');
  await page.keyboard.type(' B');
  await page.getByRole('button', { name: 'Punkt 4. nach oben' }).click();
  await expect.poll(reihenfolge(page)).toContain('3. Planung');
  await expect.poll(aktiverPunkt(page)).toBe('3. Planung');
  await page.keyboard.type('!');
  await expect(planung.locator('.punkt-text')).toHaveText('Plan B!');
  await expect(page.getByRole('region', { name: /Sonstiges/ }).locator('.punkt-text')).toHaveText(
    ''
  );
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

test('an item from an Aktion survives Backspace in its emptied title', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Aktion');
  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesordnungspunkt aus einer Aktion' });
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();
  await expect.poll(aktiverPunkt(page)).toMatch(/^5\. Pfadi-Winterlager/);
  // Backspace in the empty text goes to the title; the emptied title keeps the item and its Aktion
  await page.keyboard.press('Backspace');
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.className))
    .toContain('punkt-titel');
  // Shift+Home selects to the start of the row, which lies in the number before the title
  await page.evaluate(() => {
    const kopf = document.querySelector('[aria-label^="5. "] [data-punkt-kopf]');
    const text = kopf?.querySelector('.punkt-titel')?.firstChild;
    const nummer = kopf?.querySelector('.nummer');
    if (!text || !nummer) throw new Error('Titelzeile nicht gefunden');
    document.getSelection()?.setBaseAndExtent(text, text.textContent?.length ?? 0, nummer, 0);
  });
  // The editor moves the end into the title; a caret left there by the first Backspace would
  // only take one letter
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString()))
    .toMatch(/^Pfadi-Winterlager/);
  await page.keyboard.press('Backspace');
  await expect.poll(reihenfolge(page)).toContain('5. ');
  await page.keyboard.press('Backspace');
  await expect.poll(aktiverPunkt(page)).toBe('5. Tagesordnungspunkt');
  const winterlager = page.getByRole('region', { name: '5. Tagesordnungspunkt' });
  await expect(winterlager).toContainText('Aktion, ');
  // The button asks before it goes
  await winterlager.getByRole('button', { name: 'Punkt 5. löschen' }).click();
  await expect(page.getByRole('dialog', { name: 'Punkt 5. „Ohne Titel“ löschen?' })).toBeVisible();
});

test('pasted items bring their tasks along and get IDs of their own', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Kopie');
  const reflexion = page.getByRole('region', { name: /^2\. / });
  await reflexion.getByRole('button', { name: '+ Aufgabe' }).click();
  await reflexion.getByLabel('Aufgabe', { exact: true }).fill('Zelte zählen');
  const saved = gespeichert(page);
  await expect.poll(saved).toContain('Zelte zählen');
  const id = new URL(page.url()).searchParams.get('id');
  const lesen = async () =>
    (await (await page.request.get(`/api/intern/protokoll-editor/${id}`)).json()).inhalt.punkte as {
      id: string;
      titel: string;
      aufgaben: { id: string }[];
    }[];
  const original = (await lesen()).find((punkt) => punkt.titel === 'Reflexion');
  // The copy as the editor puts it on the clipboard, pasted at the start of the first item:
  // the copies come first, and still the original keeps its IDs
  await page
    .getByRole('region', { name: /^1\. Stufenberichte/ })
    .locator('.punkt-text')
    .first()
    .click();
  await page.locator('#protokoll-dokument').evaluate((el) => {
    const html = (el as HTMLElement & { editor: { getHTML(): string } }).editor.getHTML();
    const data = new DataTransfer();
    data.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.getByLabel('Aufgabe', { exact: true })).toHaveCount(2);
  await expect.poll(async () => (await saved()).split('Zelte zählen').length).toBe(3);
  const punkte = await lesen();
  const ids = punkte.flatMap((punkt) => [punkt.id, ...punkt.aufgaben.map((a) => a.id)]);
  expect(new Set(ids).size).toBe(ids.length);
  const kopien = punkte.filter((punkt) => punkt.titel === 'Reflexion');
  expect(kopien).toHaveLength(2);
  expect(kopien.map((punkt) => punkt.aufgaben.length)).toEqual([1, 1]);
  expect(kopien.map((punkt) => punkt.id)).toContain(original?.id);
  expect(kopien.flatMap((punkt) => punkt.aufgaben.map((a) => a.id))).toContain(
    original?.aufgaben[0].id
  );
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
  await modus.getByRole('button', { name: 'Einfacher Text (Markdown)' }).click();
  await expect(page.getByLabel('Text zu Punkt 2.')).toHaveValue('Erstens **wichtig**');
  await expect(page.getByLabel('Aufgabe', { exact: true })).toHaveValue('Nachfragen');
  await page.getByLabel('Text zu Punkt 2.').fill('Erstens **wichtig**\n\n- [ ] Zweitens');
  await modus.getByRole('button', { name: 'Formatiert' }).click();
  await expect(reflexion.locator('.punkt-text strong')).toHaveText('wichtig');
  await expect(reflexion.locator('.punkt-text').getByRole('checkbox')).toHaveCount(1);
  await expect(reflexion.getByLabel('Aufgabe', { exact: true })).toHaveValue('Nachfragen');
});
