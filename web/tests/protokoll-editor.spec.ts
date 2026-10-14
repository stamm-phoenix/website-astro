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

  await expect(page.getByLabel('Sitzungsleitung')).toHaveValue('Vera Vorstand, Volker Vorstand');
  await page.getByRole('button', { name: 'Jetzt' }).first().click();
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
  await page.getByRole('button', { name: 'Bearbeitung beenden' }).click();
  await expect(page.getByText('Gerade schreibt niemand.')).toBeVisible();
  const ansicht = page.getByRole('article', { name: 'Protokoll' });
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
