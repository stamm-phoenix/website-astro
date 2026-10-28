import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** Opens the folded filters of the Belege, closed on a phone. */
async function openFilters(page: Page): Promise<void> {
  const filters = page.locator('details', { has: page.locator('summary', { hasText: /^Filter/ }) });
  if (!(await filters.evaluate((details: HTMLDetailsElement) => details.open))) {
    await filters.locator('summary').click();
  }
}

test('closing the Beleg dialog asks before a chosen photo is discarded', async ({ page }) => {
  await page.goto('/leitendenbereich/belege/');
  await page.getByRole('button', { name: 'Beleg einreichen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  await expect(dialog).toBeVisible();

  // A light receipt on a dark background, so the scan finds its edges.
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 800, 1200);
    context.fillStyle = '#fff';
    context.fillRect(120, 120, 560, 960);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'beleg.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo),
  });
  await expect(dialog.getByText('Anderes Foto oder PDF wählen')).toBeVisible();

  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toBeVisible();
});

test('the Kasse transfers an accepted receipt to CampFlow on its Kostenstelle and Kategorie', async ({
  page,
}) => {
  // Answered here, so the shared demo keeps its receipt for the other tests
  let sent: Record<string, unknown> | undefined;
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/intern/pflege/belege/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { mailed: false, etag: 'gespeichert' } });
  });
  await page.route('**/api/intern/pflege/belege/*/campflow', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      json: {
        campflow: { state: 'Hochgeladen', number: '2026-112' },
        created: true,
        deleted: true,
      },
    });
  });
  await page.goto('/leitendenbereich/belege/');
  await openFilters(page);
  await page.getByLabel('Stand').selectOption({ label: 'Angenommen' });
  await page.getByRole('button', { name: /Deutsche Bahn/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von Deutsche Bahn' });

  // Booked on the receipt's own fields; the Kasse corrects them there
  await expect(dialog.getByLabel('Kostenstelle', { exact: true })).toHaveValue(
    'Sommerlager 2026 Oberjoch'
  );
  await expect(dialog.getByLabel('Kategorie', { exact: true })).toHaveValue('Fahrtkosten');
  await expect(dialog.getByText('Wird gebucht auf')).toContainText(
    'Sommerlager 2026 Oberjoch · Fahrtkosten'
  );
  // A Kategorie of the KJR the Kostenstelle lacks is created without a warning, any other with one
  const kategorie = dialog.getByLabel('Kategorie', { exact: true });
  await kategorie.fill('Getränke');
  await expect(dialog.getByText(/Dabei wird in „Sommerlager 2026 Oberjoch“/)).toBeVisible();
  await kategorie.fill('Honorare');
  await expect(dialog.getByText(/neu angelegt/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Nach CampFlow übertragen', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByText(
        'Beleg von Deutsche Bahn ist in CampFlow als 2026-112 gebucht und wurde hier gelöscht.'
      )
      .first()
  ).toBeVisible();
  expect(saved).toMatchObject({
    kostenstelle: 'Sommerlager 2026 Oberjoch',
    kategorie: 'Honorare',
  });
  expect(sent).toEqual({ etag: 'gespeichert' });
});

/** The field Kostenstelle, which also searches the Kategorien, and its suggestions. */
async function searchZuordnung(dialog: ReturnType<Page['getByRole']>, text: string) {
  await dialog.getByLabel('Kostenstelle', { exact: true }).fill(text);
  return dialog.getByRole('listbox', { name: 'Kostenstelle oder Kategorie auswählen' });
}

test('the field Kostenstelle finds Kostenstellen and Kategorien and fills both', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/belege/');
  await page.getByRole('button', { name: 'Beleg einreichen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const kostenstelle = dialog.getByLabel('Kostenstelle', { exact: true });
  const kategorie = dialog.getByLabel('Kategorie', { exact: true });

  let list = await searchZuordnung(dialog, 'leite');
  await list.getByRole('option', { name: 'Leitendenrunde' }).click();
  await expect(kostenstelle).toHaveValue('Allgemein');
  await expect(kategorie).toHaveValue('Leitendenrunde');

  list = await searchZuordnung(dialog, 'leite');
  await list.getByRole('option', { name: 'Leitendenlager 2026' }).click();
  await expect(kostenstelle).toHaveValue('Leitendenlager 2026');
  await expect(kategorie).toHaveValue('');

  // The KJR Kategorien come first, also where the Kostenstelle lacks them
  await kategorie.click();
  const kategorien = dialog.getByRole('listbox', { name: 'Kategorie auswählen' });
  await expect(kategorien.getByRole('option').first()).toHaveText('Fahrtkosten');
  await kategorien.getByRole('option', { name: 'Honorare' }).click();
  await expect(dialog.getByText(/gibt es .* noch nicht/)).toHaveCount(0);

  // Typed in: told it will be created
  await kostenstelle.fill('Herbstfahrt 2026');
  // Told once the field is left: while typing it is a search
  await expect(dialog.getByText(/Herbstfahrt 2026“ gibt es in CampFlow/)).toHaveCount(0);
  await kostenstelle.press('Tab');
  await expect(
    dialog.getByText('Die Kostenstelle „Herbstfahrt 2026“ gibt es in CampFlow noch nicht.', {
      exact: false,
    })
  ).toBeVisible();
});

test('Neu laden brings Kategorien changed in CampFlow into the search', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/intern/kostenstellen*', async (route) => {
    const response = await route.fetch();
    const units = (await response.json()) as Array<{
      id: string;
      categories: Array<{ id: string; name: string }>;
    }>;
    // Read again from CampFlow: Fahrtkosten was replaced by Bahnfahrten there
    if (reads++ > 0) {
      const sola = units.find((unit) => unit.id === 'cun_Sola26')!;
      sola.categories = sola.categories
        .filter((category) => category.name !== 'Fahrtkosten')
        .concat({ id: 'cat_neu', name: 'Bahnfahrten' });
    }
    await route.fulfill({ response, json: units });
  });
  await page.goto('/leitendenbereich/belege/');
  const open = async () => {
    await page.getByRole('button', { name: 'Beleg einreichen' }).first().click();
    return page.getByRole('dialog', { name: 'Beleg einreichen' });
  };
  let dialog = await open();
  let list = await searchZuordnung(dialog, 'bahn');
  await expect(list).toBeHidden();
  await dialog.getByLabel('Kostenstelle', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByText('Belege neu geladen.')).toBeVisible();
  dialog = await open();
  list = await searchZuordnung(dialog, 'bahn');
  await expect(list.getByRole('option', { name: 'Bahnfahrten' })).toBeVisible();
});

test('a late answer of an earlier Kostenstellen read keeps the newer Kategorien', async ({
  page,
}) => {
  let reads = 0;
  let oldAnswered = false;
  let releaseOld!: () => void;
  const oldHeld = new Promise<void>((resolve) => (releaseOld = resolve));
  await page.route('**/api/intern/kostenstellen*', async (route) => {
    const read = ++reads;
    const response = await route.fetch();
    const units = (await response.json()) as Array<{ id: string; categories: unknown[] }>;
    // The second read knows the Sommerlager without Kategorien and answers late
    if (read === 2) {
      units.find((unit) => unit.id === 'cun_Sola26')!.categories = [];
      await oldHeld;
    }
    await route.fulfill({ response, json: units });
    if (read === 2) oldAnswered = true;
  });
  await page.goto('/leitendenbereich/belege/');
  // „Neu laden“ reads the Kostenstellen again only once the first read is in the page
  await page.getByRole('button', { name: 'Beleg einreichen' }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  let list = await searchZuordnung(dialog, 'fahrt');
  await expect(list.getByRole('option', { name: 'Fahrtkosten' })).toBeVisible();
  await dialog.getByLabel('Kostenstelle', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();
  expect(reads).toBe(1);
  const reload = page.getByRole('button', { name: 'Neu laden' });
  await reload.click();
  await expect.poll(() => reads).toBe(2);
  // The first reload still waits for its Kostenstellen; a second one reads them anew
  await expect(reload).toBeEnabled();
  await reload.click();
  await expect.poll(() => reads).toBe(3);
  releaseOld();
  await expect.poll(() => oldAnswered).toBe(true);

  await page.getByRole('button', { name: 'Beleg einreichen' }).first().click();
  dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  list = await searchZuordnung(dialog, 'fahrt');
  await expect(
    list.getByRole('group', { name: 'Kategorie in Sommerlager 2026 Oberjoch' })
  ).toBeVisible();
});

test('a failed reload of the receipts here shows its error above the last list', async ({
  page,
}) => {
  let reads = 0;
  await page.route('**/api/intern/pflege/belege', async (route) => {
    if (route.request().method() !== 'GET' || reads++ === 0) return route.fallback();
    await route.fulfill({ status: 500, json: { error: 'Belege gerade nicht erreichbar' } });
  });
  await page.goto('/leitendenbereich/belege/');
  const list = page.getByRole('list', { name: 'Belege' });
  await expect(list.getByRole('listitem').first()).toBeVisible();

  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByText('Angezeigt wird der zuletzt geladene Stand.')).toBeVisible();
  await expect(
    page.getByRole('alert').getByRole('button', { name: 'Erneut versuchen' })
  ).toBeVisible();
  await expect(list.getByRole('listitem').first()).toBeVisible();
});

test('a retry right after a failed transfer sends the version just written, without saving again', async ({
  page,
}) => {
  // Answered here, so the shared demo keeps its receipt for the other tests
  const etags: unknown[] = [];
  let posts = 0;
  let failed = false;
  let releaseList!: () => void;
  const listHeld = new Promise<void>((resolve) => (releaseList = resolve));
  await page.route('**/api/intern/pflege/belege/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    etags.push(route.request().postDataJSON().etag);
    await route.fulfill({ json: { mailed: false, etag: `gespeichert-${etags.length}` } });
  });
  const transferred: unknown[] = [];
  await page.route('**/api/intern/pflege/belege/*/campflow', async (route) => {
    transferred.push(route.request().postDataJSON().etag);
    if (posts++ === 0) {
      failed = true;
      return route.fulfill({ status: 502, json: { error: 'CampFlow antwortet nicht' } });
    }
    await route.fulfill({
      json: {
        campflow: { state: 'Hochgeladen', number: '2026-113' },
        created: true,
        deleted: true,
      },
    });
  });
  // The list read after the failure answers late, so the retry comes first
  await page.route('**/api/intern/pflege/belege', async (route) => {
    if (route.request().method() === 'GET' && failed) await listHeld;
    await route.fallback();
  });
  await page.goto('/leitendenbereich/belege/');
  await openFilters(page);
  await page.getByLabel('Stand').selectOption({ label: 'Angenommen' });
  await page.getByRole('button', { name: /Deutsche Bahn/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von Deutsche Bahn' });
  await dialog.getByRole('textbox', { name: 'Bemerkung (optional)' }).fill('Rückfahrt');
  const transfer = dialog.getByRole('button', { name: 'Nach CampFlow übertragen', exact: true });
  await transfer.click();
  await expect(dialog.getByRole('alert')).toContainText('Der Beleg wurde nicht übertragen');

  await transfer.click();
  await expect(dialog).toBeHidden();
  releaseList();
  // Nothing changed since the save, so the retry does not save again (which would make a
  // receipt already in CampFlow look changed afterwards) and transfers the saved version
  expect(etags).toHaveLength(1);
  expect(transferred).toEqual(['gespeichert-1', 'gespeichert-1']);
});

test('my Auslage submitted by someone else is mine to look at, not to change', async ({ page }) => {
  // The API adds it read only, as someone else submitted it for the demo user's Auslage
  await page.route('**/api/intern/pflege/belege', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const belege = (await response.json()) as Record<string, unknown>[];
    const template = belege[0]!;
    await route.fulfill({
      response,
      json: [
        {
          ...template,
          id: '777',
          shop: 'Baumarkt Fremd',
          paidBy: 'Demo Leitung',
          payout: true,
          submittedBy: 'sam@example.test',
          status: 'Eingereicht',
          readOnly: true,
        },
        ...belege,
      ],
    });
  });
  await page.goto('/leitendenbereich/belege/');
  await page.getByLabel('Nur meine Belege').check();
  const list = page.getByRole('list', { name: 'Belege' });
  await list.getByRole('button', { name: /Baumarkt Fremd/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von Baumarkt Fremd' });
  await expect(dialog.getByText('sam@example.test')).toBeVisible();
  await expect(dialog.getByText('Demo Leitung')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
});

test('one list holds the receipts here and in CampFlow, filtered by source and more', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/belege/');
  const list = page.getByRole('list', { name: 'Belege' });
  const tabs = page.getByRole('group', { name: 'Nach Quelle filtern' });
  // Five in CampFlow, the receipts here first, as they wait for the Kasse
  await expect(tabs.getByRole('button', { name: /^CampFlow/ })).toHaveText(/\(5\)/);
  await expect(list.getByRole('listitem').first()).toContainText('Website');

  await tabs.getByRole('button', { name: /^CampFlow/ }).click();
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await openFilters(page);
  await page
    .getByRole('combobox', { name: 'Kostenstelle' })
    .selectOption({ label: 'Sommerlager 2026 Oberjoch' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.getByLabel('Kategorie').selectOption({ label: 'Fahrtkosten' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('Erstattet')).toBeVisible();
  await openFilters(page);
  await page.getByRole('combobox', { name: 'Kostenstelle' }).selectOption({ label: 'Alle' });
  await openFilters(page);
  await page.getByLabel('Stand').selectOption({ label: 'Gebucht' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await openFilters(page);
  await page.getByLabel('Stand').selectOption({ label: 'Alle' });

  // Own receipts: paid out of pocket by the demo user, matched by name
  await page.getByLabel('Nur meine Belege').check();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByText('Sam Beispiel')).toHaveCount(0);

  await list.getByRole('button', { name: /Edeka – Grillabend/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edeka – Grillabend' });
  await expect(dialog.getByText('2026-104')).toBeVisible();
  await expect(dialog.getByText('Gebucht, Erstattung offen')).toBeVisible();
  await expect(dialog.getByText('von dir über die Website')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'In CampFlow öffnen' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: /Beleg 2026-104/ }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();
});

test('the gallery shows previews, also of a receipt not booked yet, and opens its photo', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/belege/');
  await page
    .getByRole('group', { name: 'Ansicht' })
    .getByRole('button', { name: 'Galerie' })
    .click();
  await expect(page).toHaveURL(/ansicht=galerie/);
  const gallery = page.getByRole('list', { name: 'Belege' });
  const unbooked = gallery.getByRole('button', { name: /Kassenzettel Baumarkt\.pdf/ });
  await expect(unbooked).toContainText('Noch nicht gebucht');
  await expect(unbooked.locator('img')).toHaveJSProperty('complete', true);
  expect(
    await unbooked.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)
  ).toBeGreaterThan(0);

  await unbooked.click();
  const dialog = page.getByRole('dialog', { name: 'Kassenzettel Baumarkt.pdf' });
  await expect(dialog.getByRole('img', { name: 'Beleg' })).toBeVisible();

  // The view stays after a reload
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: 'Galerie' })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the start page lists my receipts with their state', async ({ page }) => {
  // Without receipts here, which other tests add to the shared demo
  await page.route('**/api/intern/pflege/belege', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.fallback()
  );
  await page.goto('/leitendenbereich/');
  const box = page.getByRole('region', { name: 'Meine Belege' });
  await expect(box).toBeVisible();
  const items = box.getByTestId('meine-belege').getByRole('listitem');
  await expect(items.first()).toBeVisible();
  // Submitted here and booked in CampFlow
  await expect(box.getByText('Edeka – Grillabend')).toBeVisible();
  await expect(box.getByText('Gebucht, Erstattung offen')).toBeVisible();
  await expect(box.getByRole('link', { name: 'Zu den Belegen' })).toHaveAttribute(
    'href',
    '/leitendenbereich/belege'
  );
});

test('my receipts from CampFlow show even if the submitted ones fail to load', async ({ page }) => {
  await page.route('**/api/intern/pflege/belege', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: { code: 'X', message: 'kaputt' } } })
      : route.fallback()
  );
  await page.goto('/leitendenbereich/');
  const box = page.getByRole('region', { name: 'Meine Belege' });
  // The load error says what to do and whom to ask
  await expect(box.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toBeVisible();
  await expect(box.getByText('Edeka – Grillabend')).toBeVisible();
  await expect(box.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
});

test('a transfer whose answer is lost closes the receipt once it is gone', async ({ page }) => {
  // The server transferred and deleted the receipt, but the answer never reaches the browser.
  // Simulated here, so the shared demo keeps its receipt for the other tests.
  let transferred = false;
  await page.route('**/api/intern/pflege/belege/*/campflow', async (route) => {
    transferred = true;
    await route.abort('connectionreset');
  });
  await page.route('**/api/intern/pflege/belege', async (route) => {
    if (!transferred || route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const belege = (await response.json()) as { shop: string }[];
    await route.fulfill({ response, json: belege.filter((b) => b.shop !== 'Deutsche Bahn') });
  });
  await page.goto('/leitendenbereich/belege/');
  await openFilters(page);
  await page.getByLabel('Stand').selectOption({ label: 'Angenommen' });
  await page.getByRole('button', { name: /Deutsche Bahn/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von Deutsche Bahn' });
  await dialog.getByRole('button', { name: 'Nach CampFlow übertragen', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(/Beleg von Deutsche Bahn ist hier nicht mehr vorhanden/)
  ).toBeVisible();
});

test('the receipts from CampFlow show and open even if the ones here fail to load', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/belege', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: { code: 'X', message: 'kaputt' } } })
      : route.fallback()
  );
  await page.goto('/leitendenbereich/belege/');
  await expect(page.getByRole('link', { name: 'admin@stamm-phoenix.de' }).first()).toBeVisible();
  const list = page.getByRole('list', { name: 'Belege' });
  await list.getByRole('button', { name: /Edeka – Grillabend/ }).click();
  await expect(page.getByRole('dialog', { name: 'Edeka – Grillabend' })).toBeVisible();
});

test('previews that failed are tried again after „Neu laden“', async ({ page }) => {
  let broken = true;
  await page.route('**/api/intern/abrechnung/belege/*/vorschau', (route) =>
    broken ? route.fulfill({ status: 502, body: '' }) : route.fallback()
  );
  await page.goto('/leitendenbereich/belege/?ansicht=galerie');
  const tile = page
    .getByRole('list', { name: 'Belege' })
    .getByRole('button', { name: /Kassenzettel Baumarkt\.pdf/ });
  await expect(tile.locator('img')).toHaveCount(0);
  broken = false;
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(tile.locator('img')).toHaveCount(1);
  await expect(tile.locator('img')).toHaveJSProperty('complete', true);
});

/** A one-page PDF with a line of text, written by hand with a correct cross-reference table. */
function onePagePdf(text: string): Buffer {
  const content = `BT /F1 36 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('income is submitted as a PDF without asking how it was paid', async ({ page }) => {
  let sent: Record<string, unknown> | undefined;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/intern/pflege/belege')) {
      sent = request.postDataJSON() as Record<string, unknown>;
    }
  });
  await page.goto('/leitendenbereich/belege/');
  await page.getByRole('button', { name: 'Beleg einreichen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const pdf = onePagePdf('Spendenquittung');
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'spende.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(dialog.getByAltText('Erste Seite des PDFs')).toBeVisible();
  // A PDF goes as it is: nothing to crop or turn
  await expect(dialog.getByRole('toolbar', { name: 'Foto bearbeiten' })).toHaveCount(0);

  await dialog.getByRole('radio', { name: 'Einnahme', exact: true }).check();
  await expect(dialog.getByText('Wie wurde bezahlt?')).toHaveCount(0);
  await dialog.getByLabel('Einnahme von').fill('Spende Bäckerei Huber');
  await dialog.getByLabel('Betrag in €').fill('50,00');
  await dialog.getByLabel('Kostenstelle', { exact: true }).fill('Sommerlager 2026 Oberjoch');
  await dialog.getByLabel('Kategorie', { exact: true }).fill('Spenden');
  await dialog.getByRole('button', { name: 'Einreichen', exact: true }).click();

  await expect(
    page.getByText(/Einnahme von Spende Bäckerei Huber über 50,00\s€ eingereicht/).first()
  ).toBeVisible();
  expect(sent?.art).toBe('Einnahme');
  expect(sent?.payout).toBe(false);
  expect(Buffer.from(String(sent?.pdf), 'base64').equals(pdf)).toBe(true);
  expect(Buffer.from(String(sent?.photo), 'base64').subarray(0, 2)).toEqual(
    Buffer.from([0xff, 0xd8])
  );
  const entry = page.getByRole('button', { name: /Spende Bäckerei Huber/ }).first();
  await expect(entry).toContainText('Einnahme');

  await entry.click();
  const opened = page.getByRole('dialog', { name: 'Beleg von Spende Bäckerei Huber' });
  await expect(opened.getByRole('radio', { name: 'Einnahme', exact: true })).toBeChecked();
  await expect(opened.getByRole('link', { name: 'PDF herunterladen' })).toBeVisible();
});
