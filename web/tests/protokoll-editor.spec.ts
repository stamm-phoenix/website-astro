import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { Page } from '@playwright/test';

/** Creates minutes in the editor and returns the URL of their page (without `bearbeiten`). */
async function createProtokoll(page: Page, title: string): Promise<string> {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill(title);
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();
  return page.url();
}

test('the writer types, autosave keeps it and a reload continues writing', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Autosave');
  await expectNoHorizontalOverflow(page);

  await expect(page.getByRole('list', { name: 'Sitzungsleitung' })).toHaveText(
    /Vera Vorstand\s*Volker Vorstand/
  );
  // The start of the meeting is set when the minutes are created
  await expect(page.getByLabel('Sitzungsbeginn', { exact: true })).toHaveValue(/^\d\d:\d\d$/);
  await page
    .getByRole('group', { name: 'Anwesenheit Lea Leiterin' })
    .getByRole('button', { name: 'da' })
    .click();

  await page.getByLabel('Text zu Punkt 1a.').fill('Erste Hilfe geübt\n- Pflaster\n- Verbände');
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  await page.reload();
  // The tab wrote before the reload, so it writes on
  await expect(page.getByLabel('Text zu Punkt 1a.')).toHaveValue(
    'Erste Hilfe geübt\n- Pflaster\n- Verbände'
  );
  // Without an end the editor asks whether the meeting ends now
  await page.getByRole('button', { name: 'Bearbeitung beenden' }).click();
  const frage = page.getByRole('dialog', { name: 'Sitzungsende eintragen?' });
  await frage.getByRole('button', { name: 'Ja, Ende auf jetzt setzen' }).click();
  await expect(page.getByText(/Sitzungsende \d\d:\d\d Uhr eingetragen/).first()).toBeVisible();
  await expect(page.getByText('Gerade schreibt niemand.')).toBeVisible();
  const ansicht = page.getByRole('article', { name: 'Protokoll' });
  await expect(ansicht.locator('header')).toContainText(/\d\d:\d\d–\d\d:\d\d Uhr/);
  await expect(ansicht.getByRole('listitem').filter({ hasText: 'Verbände' })).toBeVisible();
  await expect(ansicht.getByText('Lea Leiterin')).toBeVisible();
});

test('an agenda item comes from an Aktion with its dates below the title', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Aktion');
  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesordnungspunkt aus einer Aktion' });
  // Aktionen over before the meeting are hidden unless asked for
  await dialog.getByLabel('Aktion suchen').fill('Stammesversammlung');
  await expect(dialog.getByText('Keine passende Aktion gefunden.')).toBeVisible();
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();
  await expect(page.getByLabel('Titel von Punkt 5.')).toHaveValue(
    'Pfadi-Winterlager auf der Hütte'
  );
  await expect(
    page.getByRole('region', { name: /^5\. Pfadi-Winterlager/ }).getByText(/^Aktion, \d/)
  ).toBeVisible();
  await expect(page.getByLabel('Text zu Punkt 5.')).toBeFocused();
});

test('others read along live and can take over after asking', async ({
  page,
  browser,
  baseURL,
}) => {
  const url = await createProtokoll(page, 'Leitendenrunde Live');
  await page.getByLabel('Text zu Punkt 2.').fill('Stammestag war super.');
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  const readerContext = await browser.newContext({ baseURL });
  const reader = await readerContext.newPage();
  await reader.goto(url.replace(/&bearbeiten=1$/, ''));
  await expect(reader.getByRole('status').filter({ hasText: 'schreibt gerade' })).toContainText(
    'Demo Leitung'
  );
  await expect(reader.getByText('Stammestag war super.')).toBeVisible();

  // Whoever shares their screen instead of the writer can open the same presentation
  const [readerPraesentation] = await Promise.all([
    readerContext.waitForEvent('page'),
    reader.getByRole('button', { name: 'Präsentation öffnen' }).click(),
  ]);
  await expect(
    readerPraesentation
      .getByRole('article', { name: 'Protokoll' })
      .getByText('Stammestag war super.')
  ).toBeVisible();
  await readerPraesentation.close();

  // A change of the writer reaches the reader without reloading
  await page.getByLabel('Text zu Punkt 3.').fill('Pfingstlager planen.');
  await expect(reader.getByText('Pfingstlager planen.')).toBeVisible({ timeout: 10_000 });

  await reader.getByRole('button', { name: 'Bearbeitung übernehmen' }).click();
  const confirm = reader.getByRole('dialog', { name: 'Bearbeitung übernehmen?' });
  await expect(confirm).toContainText('Demo Leitung schreibt gerade');
  await confirm.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(reader.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();

  // The former writer cannot save any more and is told so
  await page.getByLabel('Text zu Punkt 4.').fill('Nach der Übernahme getippt.');
  await expect(page.getByText(/hat die Bearbeitung übernommen/).first()).toBeVisible();
  await expect(page.getByText(/nicht gespeicherte Fassung/)).toBeVisible();
  await readerContext.close();
});

test('without a connection the changes stay on the device and are saved later', async ({
  page,
}) => {
  await createProtokoll(page, 'Leitendenrunde Offline');
  await page.route('**/api/intern/pflege/protokoll-editor/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue()
  );
  await page.getByLabel('Text zu Punkt 4.').fill('Getippt ohne Verbindung.');
  await expect(
    page.getByText(/^Offline – Änderungen sind auf diesem Gerät gesichert/)
  ).toBeVisible();

  await page.unroute('**/api/intern/pflege/protokoll-editor/*');
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel('Text zu Punkt 4.')).toHaveValue('Getippt ohne Verbindung.');
});

test('the presentation opens in a window of its own and follows every change', async ({
  page,
  context,
}) => {
  await createProtokoll(page, 'Leitendenrunde Präsentation');
  const [praesentation] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Präsentation öffnen' }).click(),
  ]);
  await expect(praesentation).toHaveURL(/\/leitendenbereich\/protokolle\/praesentation\?id=\d+$/);
  const ansicht = praesentation.getByRole('article', { name: 'Protokoll' });
  await expect(
    ansicht.getByRole('heading', { name: /Leitendenrunde Präsentation am/ })
  ).toBeVisible();
  // Only the minutes: no site header, no fields, no editing buttons
  await expect(praesentation.getByRole('textbox')).toHaveCount(0);
  await expect(praesentation.getByRole('link', { name: 'Leitendenbereich' })).toHaveCount(0);
  await expect(praesentation.getByRole('button')).toHaveCount(0);

  // Typing in the editor shows up right away, without waiting for the server
  await page.getByLabel('Text zu Punkt 4.').fill('Termin für den Stammestag steht.');
  const sonstiges = praesentation.locator('section', { hasText: '4. Sonstiges' });
  await expect(sonstiges).toContainText('Termin für den Stammestag steht.', { timeout: 2000 });
  await expect(sonstiges).toBeInViewport();

  await page.getByLabel('Titel von Punkt 2.').fill('Rückblick Stammestag');
  await expect(ansicht.getByRole('heading', { name: '2. Rückblick Stammestag' })).toBeVisible({
    timeout: 2000,
  });
});

test('a late answer of the server never replaces newer text from the editor', async ({
  page,
  context,
}) => {
  await createProtokoll(page, 'Leitendenrunde Reihenfolge');
  await page.getByLabel('Text zu Punkt 3.').fill('Alter Stand.');
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  // The window loads without a tab token: hold its first answer back until the editor has
  // sent a newer version directly
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await context.route(/\/api\/intern\/protokoll-editor\/\d+$/, async (route) => {
    if (route.request().headers()['x-protokoll-tab']) return route.continue();
    await held;
    await route.continue();
  });

  const [praesentation] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Präsentation öffnen' }).click(),
  ]);
  const planung = praesentation.locator('section', { hasText: '3. Planung' });
  await expect(planung).toContainText('Alter Stand.');
  await page.getByLabel('Text zu Punkt 3.').fill('Neuer Stand, noch nicht gespeichert.');
  await expect(planung).toContainText('Neuer Stand, noch nicht gespeichert.');

  release();
  await praesentation.waitForResponse(/\/api\/intern\/protokoll-editor\/\d+$/);
  await praesentation.waitForTimeout(300);
  await expect(planung).toContainText('Neuer Stand, noch nicht gespeichert.');
});

test('the presentation recovers when its first load fails', async ({ page, browser, baseURL }) => {
  const url = await createProtokoll(page, 'Leitendenrunde Wiederholung');
  await page.getByLabel('Text zu Punkt 2.').fill('Steht schon auf dem Server.');
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeitung beenden' }).click();
  await page.getByRole('button', { name: 'Nein, Ende leer lassen' }).click();
  await expect(page.getByText('Gerade schreibt niemand.')).toBeVisible();

  // A reader on another device: no writing tab in its browser, only the server
  const readerContext = await browser.newContext({ baseURL });
  const reader = await readerContext.newPage();
  let failed = false;
  await readerContext.route(/\/api\/intern\/protokoll-editor\/\d+$/, async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.abort();
  });
  await reader.goto(url.replace(/&bearbeiten=1$/, '').replace('/protokoll?', '/praesentation?'));
  await expect(reader.getByRole('alert')).toContainText('erneut versucht');
  await expect(
    reader.getByRole('article', { name: 'Protokoll' }).getByText('Steht schon auf dem Server.')
  ).toBeVisible({ timeout: 10_000 });
  await expect(reader.getByRole('alert')).toHaveCount(0);
  await readerContext.close();
});

test('names are picked from Leitende and Altleitende or typed for guests', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Namen');
  await expect(page.getByRole('list', { name: 'Protokoll' })).toHaveText('Demo Leitung');

  // One person writes the minutes: picking another replaces them
  const protokoll = page.getByRole('combobox', { name: 'Protokoll' });
  await protokoll.fill('anna');
  await expect(protokoll).toHaveAttribute('aria-expanded', 'true');
  const altleitende = page.getByRole('group', { name: 'Altleitende' });
  await expect(altleitende.getByRole('option', { name: 'Anna Altleiterin' })).toBeVisible();
  await protokoll.press('ArrowDown');
  await expect(protokoll).toHaveAttribute('aria-activedescendant', /option-0$/);
  await protokoll.press('Enter');
  await expect(page.getByRole('list', { name: 'Protokoll' })).toHaveText('Anna Altleiterin');

  // Further people present: from the list, or typed by hand
  const weitere = page.getByRole('combobox', { name: 'Weitere Person als anwesend eintragen' });
  await weitere.fill('Ingo');
  await expect(page.getByRole('option', { name: 'Ingo Inaktiv' })).toHaveCount(0);
  await weitere.fill('Otto');
  await page.getByRole('option', { name: 'Otto Ehemalig' }).click();
  await expect(
    page
      .getByRole('group', { name: 'Anwesenheit Otto Ehemalig' })
      .getByRole('button', { name: 'da' })
  ).toHaveAttribute('aria-pressed', 'true');
  await weitere.fill('Gustav Gast');
  await weitere.press('Enter');
  await expect(
    page.getByRole('group', { name: 'Anwesenheit Gustav Gast' }).getByRole('button', { name: 'da' })
  ).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Bearbeitung beenden' }).click();
  await page.getByRole('button', { name: 'Nein, Ende leer lassen' }).click();
  const kopf = page.getByRole('article', { name: 'Protokoll' }).locator('header');
  await expect(kopf).toContainText('Anna Altleiterin');
  await expect(kopf.getByRole('list', { name: 'Anwesend' })).toContainText('Otto Ehemalig');
  await expect(kopf.getByRole('list', { name: 'Anwesend' })).toContainText('Gustav Gast');
});

test('a Termin is added per item like an Aufgabe and shown in the minutes', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Termine');
  const planung = page.getByRole('region', { name: '3. Planung' });
  await planung.getByRole('button', { name: '+ Termin' }).click();
  await expect(planung.getByLabel('Termin', { exact: true })).toBeFocused();
  await planung.getByLabel('Termin', { exact: true }).fill('Vortreffen Pfingstlager');
  await planung.getByLabel('Datum', { exact: true }).fill('2026-11-02');
  await planung.getByLabel('Uhrzeit', { exact: true }).fill('18:00');
  await planung.getByLabel('Ort', { exact: true }).fill('Stammesheim');
  const zustaendig = planung.getByRole('combobox', { name: 'Zuständig' });
  await zustaendig.fill('Lea');
  await zustaendig.press('Enter');
  await expect(planung.getByRole('button', { name: 'Lea Leiterin entfernen' })).toBeVisible();
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  await page.reload();
  await expect(planung.getByLabel('Termin', { exact: true })).toHaveValue(
    'Vortreffen Pfingstlager'
  );

  await page.getByRole('button', { name: 'Leseansicht' }).click();
  const vorschau = page.getByRole('dialog', { name: 'Leseansicht' });
  const termine = vorschau.getByRole('table', { name: 'Termine zu Punkt 3.' });
  await expect(termine).toContainText('Vortreffen Pfingstlager');
  await expect(termine).toContainText('Mo., 02.11.2026, 18:00 Uhr');
  await expect(termine).toContainText('Lea Leiterin');
  await expect(vorschau.getByRole('table', { name: 'Alle Termine' })).toContainText(
    'Vortreffen Pfingstlager'
  );
  await vorschau.getByRole('button', { name: /Schließen/ }).click();

  // An item with a Termin has content: deleting it asks first
  await planung.getByRole('button', { name: 'Punkt 3. löschen' }).click();
  await expect(page.getByRole('dialog', { name: /^Punkt 3\. „.+“ löschen\?$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await planung.getByRole('button', { name: 'Termin Vortreffen Pfingstlager entfernen' }).click();
  await expect(planung.getByLabel('Termin', { exact: true })).toHaveCount(0);
});

test('the text understands Markdown and never runs HTML', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Markdown');
  const text = page.getByLabel('Text zu Punkt 2.');
  await text.fill(
    [
      'Mit *kursiv*, ~~alt~~ und `Code`.',
      '',
      '1. eins',
      '2. zwei',
      '',
      '- [x] erledigt',
      '- [ ] offen',
      '',
      '| Was | Wer |',
      '| --- | --- |',
      '| Zelte | Lea |',
      '',
      '> Zitat',
      '',
      'Siehe https://dpsg.de und [böse](javascript:window.__xss=1)',
      '',
      '<img src="x" onerror="window.__xss=1"> <script>window.__xss=1</script>',
    ].join('\n')
  );
  // Enter continues a numbered list
  await page.getByLabel('Text zu Punkt 4.').fill('1. erster');
  await page.getByLabel('Text zu Punkt 4.').press('End');
  await page.getByLabel('Text zu Punkt 4.').press('Enter');
  await expect(page.getByLabel('Text zu Punkt 4.')).toHaveValue('1. erster\n2. ');

  await page.getByRole('button', { name: 'Leseansicht' }).click();
  const punkt = page.getByRole('dialog', { name: 'Leseansicht' }).getByRole('region', {
    name: '2. Reflexion',
  });
  await expect(punkt.locator('em')).toHaveText('kursiv');
  await expect(punkt.locator('del')).toHaveText('alt');
  await expect(punkt.locator('ol > li')).toHaveText(['eins', 'zwei']);
  await expect(punkt.getByText('Erledigt:')).toHaveCount(1);
  await expect(punkt.getByRole('cell', { name: 'Zelte' })).toBeVisible();
  await expect(punkt.locator('blockquote')).toHaveText('Zitat');
  await expect(punkt.getByRole('link', { name: 'https://dpsg.de' })).toHaveAttribute(
    'href',
    'https://dpsg.de'
  );
  // Unsafe links and HTML stay text and never run
  await expect(punkt.getByRole('link', { name: 'böse' })).toHaveCount(0);
  await expect(punkt).toContainText('<script>window.__xss=1</script>');
  await expect(punkt.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
});

test('the formatting editor writes Markdown that the minutes render the same', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Formatiert');
  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Formatiert' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  const text = region.getByRole('textbox', { name: 'Text zu Punkt 2.' });
  const tools = region.getByRole('toolbar', { name: 'Formatierung' });
  await expectNoHorizontalOverflow(page);

  await text.click();
  await page.keyboard.type('Stammestag war ');
  await tools.getByRole('button', { name: 'Fett' }).click();
  await expect(tools.getByRole('button', { name: 'Fett' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('super');
  await tools.getByRole('button', { name: 'Fett' }).click();
  await page.keyboard.type(' und <3, Tag <b>x</b>');
  await page.keyboard.press('Enter');
  await tools.getByRole('button', { name: 'Checkliste' }).click();
  await page.keyboard.type('Fotos sortieren');
  await expect(text.locator('strong')).toHaveText('super');
  await expect(text.getByRole('checkbox')).toHaveCount(1);
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();

  // The Markdown field shows what is stored, and the editor reads it back; HTML typed as
  // text stays text, as the minutes show it
  await modus.getByRole('button', { name: 'Markdown' }).click();
  await expect(page.getByLabel('Text zu Punkt 2.')).toHaveValue(
    'Stammestag war **super** und <3, Tag <b>x</b>\n\n- [ ] Fotos sortieren'
  );
  await modus.getByRole('button', { name: 'Formatiert' }).click();
  await expect(text.locator('strong')).toHaveText('super');
  await expect(text).toContainText('Tag <b>x</b>');
  await expect(text.getByRole('checkbox')).toHaveCount(1);

  await page.getByRole('button', { name: 'Leseansicht' }).click();
  const punkt = page.getByRole('dialog', { name: 'Leseansicht' }).getByRole('region', {
    name: '2. Reflexion',
  });
  await expect(punkt.locator('strong')).toHaveText('super');
  await expect(punkt).toContainText('und <3, Tag <b>x</b>');
  await expect(punkt.getByText('Offen:')).toHaveCount(1);
});

test('a new item from an Aktion gets the focus while the formatting editor still loads', async ({
  page,
}) => {
  await createProtokoll(page, 'Leitendenrunde Fokus');
  // The editor arrives slowly, as on a phone with a weak connection
  await page.route('**/TextEditor*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Formatiert' })
    .click();
  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesordnungspunkt aus einer Aktion' });
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();
  await expect(page.getByRole('textbox', { name: 'Text zu Punkt 5.' })).toBeFocused();
});

test('the loading editor does not take the focus from a field the person chose', async ({
  page,
}) => {
  await createProtokoll(page, 'Leitendenrunde Fokus bleibt');
  await page.route('**/TextEditor*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Formatiert' })
    .click();
  await page.getByRole('button', { name: '+ Punkt aus Aktion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tagesordnungspunkt aus einer Aktion' });
  await dialog.getByLabel('Aktion suchen').fill('Winterlager');
  await dialog.getByRole('button', { name: /Pfadi-Winterlager/ }).click();
  // While the editor still loads, the person edits the title
  const titel = page.getByLabel('Titel von Punkt 5.');
  await titel.click();
  await titel.press('End');
  await page.keyboard.type(' 2027');
  const text = page.getByRole('textbox', { name: 'Text zu Punkt 5.' });
  await expect(text).toBeVisible();
  await page.waitForTimeout(300);
  await expect(titel).toBeFocused();
  await expect(titel).toHaveValue('Pfadi-Winterlager auf der Hütte 2027');
});

test('when the formatting editor cannot be loaded, the Markdown field stays', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Ladefehler');
  await page.getByLabel('Text zu Punkt 2.').fill('Bleibt erhalten');
  // The download of the editor fails, e.g. without a connection
  await page.route('**/TextEditor*', (route) => route.abort());
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Formatiert' })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Editor konnte nicht geladen werden' }).first()
  ).toBeVisible();
  await expect(page.getByLabel('Text zu Punkt 2.')).toHaveValue('Bleibt erhalten');
});

test('Altleitende are kept in their own module and offered in the minutes', async ({ page }) => {
  await page.goto('/leitendenbereich/personen');
  await expect(page.getByRole('region', { name: 'Altleitende' })).toContainText('Anna Altleiterin');
  await page.getByRole('button', { name: 'Person hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Person hinzufügen' });
  await dialog.getByLabel('Name').fill('Berta Beispiel');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Altleitende' })).toContainText('Berta Beispiel');
  await expectNoHorizontalOverflow(page);

  await createProtokoll(page, 'Leitendenrunde Berta');
  const leitung = page.getByRole('combobox', { name: 'Sitzungsleitung' });
  await leitung.fill('Berta');
  await page
    .getByRole('group', { name: 'Altleitende' })
    .getByRole('option', { name: 'Berta Beispiel' })
    .click();
  await expect(page.getByRole('list', { name: 'Sitzungsleitung' })).toContainText('Berta Beispiel');
});

test('the start can stay empty and leaving without an end keeps it empty', async ({ page }) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde ohne Zeiten');
  const jetzt = page.getByLabel('Sitzungsbeginn auf jetzt setzen');
  await expect(jetzt).toBeChecked();
  await jetzt.uncheck();
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByLabel('Sitzungsbeginn', { exact: true })).toHaveValue('');

  await page.getByRole('button', { name: 'Bearbeitung beenden' }).click();
  const frage = page.getByRole('dialog', { name: 'Sitzungsende eintragen?' });
  // Closing the question keeps writing
  await frage.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(page.getByLabel('Sitzungsende', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeitung beenden' }).click();
  await frage.getByRole('button', { name: 'Nein, Ende leer lassen' }).click();
  await expect(page.getByText('Gerade schreibt niemand.')).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Protokoll' }).locator('header')
  ).not.toContainText('Uhr');
});

test('agenda items are dragged into a new order and between the levels', async ({ page }) => {
  await createProtokoll(page, 'Leitendenrunde Reihenfolge');
  /** Number and title of every item, in the order of the editor. */
  const reihenfolge = (): Promise<string[]> =>
    page
      .locator('[data-punkt-kopf]')
      .evaluateAll((rows) =>
        rows.map(
          (row) =>
            `${row.querySelector('.nummer')?.textContent?.trim()} ${(row.querySelector('input') as HTMLInputElement).value}`
        )
      );
  await expect
    .poll(reihenfolge)
    .toEqual([
      '1. Stufenberichte',
      '1a. Wölflinge',
      '1b. Jungpfadfinder',
      '1c. Pfadfinder',
      '1d. Rover',
      '1e. StaVos',
      '2. Reflexion',
      '3. Planung',
      '4. Sonstiges',
    ]);

  // A move that is not possible says why
  await page.getByRole('button', { name: /^1\. Stufenberichte verschieben/ }).press('ArrowUp');
  await expect(
    page.getByRole('status').filter({ hasText: '„Stufenberichte“ steht schon ganz oben.' })
  ).toBeVisible();

  // The keyboard on the handle: left makes a sub-item an item, right the other way round
  await page.getByRole('button', { name: /^1e\. StaVos verschieben/ }).press('ArrowLeft');
  await expect(
    page.getByRole('status').filter({ hasText: '„StaVos“ ist jetzt Punkt 2.' })
  ).toBeVisible();
  await page.getByRole('button', { name: /^3\. Reflexion verschieben/ }).press('ArrowRight');
  await expect(page.getByLabel('Titel von Punkt 2a.')).toHaveValue('Reflexion');

  // Dragging „Sonstiges“ up and to the right below „Reflexion“ makes it a sub-item of „StaVos“
  const griff = page.getByRole('button', { name: /^4\. Sonstiges verschieben/ });
  await griff.scrollIntoViewIfNeeded();
  const start = (await griff.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 12);
  // While dragging, the items shrink to their title rows
  await expect(page.getByLabel('Text zu Punkt 1a.')).toBeHidden();
  const ziel = (await page.locator('[data-punkt-kopf]').nth(7).boundingBox())!;
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x + step * 6, y - 12 + ((ziel.y + 4 - y + 12) * step) / 10);
  }
  await expect(page.getByText('als Unterpunkt von 2. StaVos')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByLabel('Text zu Punkt 1a.')).toBeVisible();
  await expect
    .poll(reihenfolge)
    .toEqual([
      '1. Stufenberichte',
      '1a. Wölflinge',
      '1b. Jungpfadfinder',
      '1c. Pfadfinder',
      '1d. Rover',
      '2. StaVos',
      '2a. Reflexion',
      '2b. Sonstiges',
      '3. Planung',
    ]);

  // A click on the handle without moving changes nothing
  await page.getByRole('button', { name: /^3\. Planung verschieben/ }).click();
  await expect(page.getByLabel('Titel von Punkt 3.')).toHaveValue('Planung');
  await expectNoHorizontalOverflow(page);

  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Titel von Punkt 2b.')).toHaveValue('Sonstiges');
});
