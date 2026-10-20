import { resetAccountingInputs } from './abrechnung-helpers';
import { readFile } from 'node:fs/promises';
import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';

test.beforeEach(async ({ page }) => {
  await resetAccountingInputs(page);
});

test('a receipt is submitted with a photo and checked by the Kassenteam', async ({
  page,
}, testInfo) => {
  await page.goto('/leitendenbereich/belege');
  await expect(page.getByText('REWE', { exact: true })).toBeVisible();
  await expect(page.getByText('Evtl. Alkohol/Tabak')).toBeVisible();
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).click();

  // A photo of a slightly turned receipt on a dark table, drawn in the browser
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3a3027';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(600, 800);
    context.rotate(0.08);
    context.fillStyle = '#f4f1ea';
    context.fillRect(-350, -600, 700, 1200);
    context.fillStyle = '#222';
    context.font = '36px sans-serif';
    for (let line = 0; line < 22; line++)
      context.fillText(`Artikel ${line}   1,99 EUR`, -300, -540 + line * 52);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'beleg.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) });
  await expect(page.getByAltText('Vorschau des Scans')).toBeVisible();
  // Corners can be moved with the keyboard as well
  await page.getByRole('button', { name: /Ecke oben links verschieben/ }).press('ArrowLeft');
  await expect(page.getByAltText('Vorschau des Scans')).toBeVisible();
  await expect(
    page.getByRole('note').filter({ hasText: /Foto geprüft|Foto prüfen/ })
  ).toBeVisible();
  await expect(page.getByLabel('Geschäft')).toHaveValue('Demo-Markt');
  await expect(page.getByLabel('Betrag in €')).toHaveValue('9,99');

  const shop = `Testmarkt ${testInfo.project.name}`;
  await page.getByLabel('Geschäft').fill(shop);
  await page.getByLabel('Betrag in €').fill('12,34');
  await page.getByLabel('Aktion', { exact: true }).fill('Wölflings-Herbstwochenende');
  await page
    .getByRole('radio', { name: 'Mit meinem Geld – bitte an mich auszahlen', exact: true })
    .check();
  await page.getByRole('button', { name: 'Einreichen', exact: true }).click();
  // On small screens the page message is scrolled away and repeated in a popup.
  const submitted = page.getByText(/über 12,34\s€ eingereicht/);
  await expect(submitted.first()).toBeVisible();
  await expect(submitted.last()).toBeInViewport();
  await expect(page.getByText(shop, { exact: true })).toBeVisible();

  const card = page.getByRole('button', { name: new RegExp(shop) });
  await card.click();
  await expect(page.getByText(/Eingereicht von leitung@example\.test/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Original ansehen' })).toBeVisible();
  // Rejecting needs a reason, which is mailed to the uploader
  await page.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(page.getByText('Bitte begründen, warum der Beleg abgelehnt wird.')).toBeVisible();
  await page.getByLabel('Bemerkung der Kasse').fill('Bitte die Rückseite mit dem Betrag ergänzen.');
  await page.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(
    page.getByText(/abgelehnt\. leitung@example\.test hat die Begründung/)
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: /^Abgelehnt/ }).click();
  await card.click();
  await page.getByRole('button', { name: 'Erneut einreichen', exact: true }).click();
  await expect(page.getByText(`Beleg von ${shop} erneut eingereicht.`)).toBeVisible();
  await page.getByRole('button', { name: /^Offen/ }).click();
  await card.click();
  await page.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(page.getByText(new RegExp(`Beleg von ${shop} angenommen`))).toBeVisible();
  await page.getByRole('button', { name: /^Angenommen/ }).click();
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('an Einzelnachweis opens with its receipt and its amount can be changed', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=nachweise');
  const zeile = page.getByRole('row', { name: /2026-103/ });
  await zeile.getByRole('button', { name: /Zeltplatz/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Beleg 2026-103' });
  await expect(dialog).toContainText('Unterkunft');
  await expect(dialog.getByRole('img', { name: 'Beleg 2026-103' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // An expense stays an expense; the amount is entered without sign
  const betrag = dialog.getByLabel('Betrag der Ausgabe');
  await expect(betrag).toHaveValue('400,00');
  await betrag.fill('abc');
  await dialog.getByRole('button', { name: 'Betrag übernehmen' }).click();
  await expect(betrag).toHaveAttribute('aria-invalid', 'true');
  // A minus as shown in the list is ignored
  await betrag.fill('-300');
  await dialog.getByRole('button', { name: 'Betrag übernehmen' }).click();
  await expect(dialog).toBeHidden();
  await expect(zeile).toContainText(/-300,00\s€/);
  await expect(zeile.getByTestId('betrag-campflow')).toContainText(/-400,00\s€/);

  // Exporting again keeps the changed amount
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByRole('button', { name: 'Neu laden' })).toBeEnabled();
  await expect(zeile).toContainText(/-300,00\s€/);

  // The Übersicht and the Auslagen count the changed amount: -3.150,33 € + 100 €
  await page.getByRole('tab', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('ergebnis')).toHaveText(/-3\.050,33\s€/);
  await expect(page.getByTestId('betraege-geaendert')).toBeVisible();
  await expect(page.getByTestId('auslagen').getByRole('row', { name: /Kim Muster/ })).toContainText(
    /1\.309,90\s€/
  );

  // Saving keeps the changed amount on the account across navigation.
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  const dialogs: string[] = [];
  page.on('dialog', (confirm) => {
    dialogs.push(confirm.message());
    void confirm.dismiss();
  });
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Abrechnung', exact: true })
    .click();
  await expect(page).toHaveURL(/\/leitendenbereich\/abrechnung$/);
  await page.getByRole('link', { name: /Sommerlager 2026 Oberjoch/ }).click();
  await expect(page.getByTestId('ergebnis')).toHaveText(/-3\.050,33\s€/);
  expect(dialogs).toEqual([]);

  // CampFlow's amount can be restored
  await page
    .getByTestId('betraege-geaendert')
    .getByRole('button', { name: 'Zu den Einzelnachweisen' })
    .click();
  await zeile.getByRole('button', { name: /Zeltplatz/ }).click();
  await dialog.getByRole('button', { name: 'CampFlow-Betrag' }).click();
  await expect(zeile).toContainText(/-400,00\s€/);
  await expect(zeile.getByTestId('betrag-campflow')).toHaveCount(0);

  // Save restoring CampFlow's amount before leaving.
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Abrechnung', exact: true })
    .click();
  await expect(page).toHaveURL(/\/leitendenbereich\/abrechnung$/);
});

test('Materialleihgebühren count as virtual expense and all Abrechnung PDFs download', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=leihgebuehren');
  // Counts and the default duration are visible as actual field values
  const anzahl = page.getByLabel('Anzahl Jurte');
  await expect(anzahl).toHaveValue('0');
  await expect(page.getByLabel('Tage Jurte')).toHaveValue('10');
  // 2 Jurten × 25 € × 10 days (the days of the KJR grant)
  await anzahl.fill('2');
  await expect(anzahl).toHaveValue('2');
  await expect(page.getByTestId('leihgebuehren-summe')).toHaveText(/500,00\s€/);
  await expect(page.getByTestId('leihgebuehren-endergebnis')).toBeVisible();
  await page.getByLabel('Tage Jurte').fill('4');
  await expect(page.getByTestId('leihgebuehren-summe')).toHaveText(/200,00\s€/);
  // The tab shows that something is entered
  await expect(page.getByTestId('tab-leihgebuehren-summe')).toHaveText(/200,00\s€/);
  await expectNoHorizontalOverflow(page);

  const leihDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als PDF herunterladen' }).click();
  expect((await leihDownload).suggestedFilename()).toBe(
    'Materialleihgebuehren Sommerlager 2026 Oberjoch.pdf'
  );

  // Virtual expense in the overview: -3.150,33 € - 200 €
  await page.getByRole('tab', { name: 'Übersicht' }).click();
  await expect(page.getByTestId('ergebnis')).toHaveText(/-3\.350,33\s€/);
  await expect(page.getByText('Unterkunft (Materialleihgebühren, virtuell)')).toBeVisible();
  await expect(page.getByTestId('abrechnung-ziel')).toBeVisible();

  await page.getByLabel('Vorkalkulation von').fill('Kim Muster');
  const deckblattDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Deckblatt als PDF herunterladen' }).click();
  expect((await deckblattDownload).suggestedFilename()).toBe(
    'Deckblatt Sommerlager 2026 Oberjoch.pdf'
  );

  // … and in the Einzelnachweise, where the receipts are added page by page
  await page.getByRole('tab', { name: /Einzelnachweise/ }).click();
  await expect(page.getByText('13 von 13 Buchungen')).toBeVisible();
  await expect(page.getByRole('row', { name: /virtuell/ })).toBeVisible();
  const belegeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Mit Belegen als PDF' }).click();
  const belegePdf = await belegeDownload;
  expect(belegePdf.suggestedFilename()).toBe(
    'Einzelnachweise mit Belegen Sommerlager 2026 Oberjoch.pdf'
  );
  const pdf = (await readFile(await belegePdf.path())).toString('latin1');
  // List, 9 receipts and the Leihgebühren as their own pages
  expect(pdf.match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThanOrEqual(11);

  // Only receipts of the bookings have an image
  expect((await page.request.get('/api/intern/abrechnung/belege/2026-101/bild')).status()).toBe(
    200
  );
  const unknown = await page.request.get('/api/intern/abrechnung/belege/2026-999/bild');
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).code).toBe('BELEG_NOT_FOUND');
});

test('a QR code is styled and downloaded as PNG', async ({ page }) => {
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: /QR-Code/ }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/qr-code$/);
  const download = page.getByRole('button', { name: 'Als Bild herunterladen' });
  await expect(download).toBeDisabled();

  // A web address without https:// is offered to be completed
  const text = page.getByLabel('Link oder Text');
  await text.fill('stamm-phoenix.de');
  await page.getByRole('button', { name: 'https:// ergänzen' }).click();
  await expect(text).toHaveValue('https://stamm-phoenix.de');
  await expect(
    page.getByRole('img', { name: 'QR-Code für https://stamm-phoenix.de' })
  ).toBeVisible();

  // Colour and form
  await page.getByRole('button', { name: 'DPSG-Rot', exact: true }).click();
  await expect(page.getByRole('button', { name: 'DPSG-Rot', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page
    .getByRole('group', { name: 'Form der Punkte' })
    .getByRole('button', { name: 'Punkte', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Form der Ecken' })
    .getByRole('button', { name: 'Rund', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Phoenix' }).check();
  await expect(page.getByRole('radio', { name: 'Phoenix' })).toBeChecked();
  await page.getByRole('radio', { name: 'Lilie' }).check();
  await page.getByLabel('Hintergrund').fill('#888888');
  await expect(page.getByText(/Geringer Kontrast/)).toBeVisible();
  await page.getByLabel('Transparent').check();
  await expect(page.getByText(/Geringer Kontrast/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByLabel('Größe', { exact: true }).selectOption('2048');
  const pngDownload = page.waitForEvent('download');
  await download.click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe('QR-Code stamm-phoenix.de.png');
  const content = await readFile(await png.path());
  expect(content.subarray(1, 4).toString()).toBe('PNG');
  // Width and height from the IHDR chunk
  expect(content.readUInt32BE(16)).toBe(2048);
  expect(content.readUInt32BE(20)).toBe(2048);

  // Too much text for a QR code with a logo (highest error correction)
  await text.fill('x'.repeat(2000));
  await expect(page.getByText('Der Text ist zu lang für einen QR-Code.')).toBeVisible();
  await expect(download).toBeDisabled();
});

test('an Eigenbeleg is filled in and downloaded as PDF', async ({ page }) => {
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: /Eigenbeleg/ }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/eigenbeleg$/);
  // The logged-in user paid
  await expect(page.getByLabel('Ausgelegt von')).toHaveValue('Demo Leitung');

  // Missing details are marked and the first one is focused
  const download = page.getByRole('button', { name: 'Als PDF herunterladen' });
  await download.click();
  await expect(page.getByText('Bitte ergänze die markierten Angaben.')).toBeVisible();
  await expect(page.getByLabel('Bezahlt an')).toBeFocused();

  // The fixtures fix the clock at 2026-10-01
  await page.getByLabel('Bezahlt an').fill('Parkhaus Oberjoch');
  await page.getByLabel('Datum der Zahlung').fill('2026-08-03');
  await page.getByLabel('Zahlungsart').selectOption('Bar');
  await page.getByLabel('Aktion oder Zweck').fill('Sommerlager 2026 Oberjoch');
  await page.getByLabel('Posten 1', { exact: true }).fill('Parkgebühr Materialanhänger');
  await page.getByLabel('Betrag Posten 1 in €').fill('12,50');
  await page.getByRole('button', { name: 'Posten hinzufügen' }).click();
  await expect(page.getByLabel('Posten 2', { exact: true })).toBeFocused();
  await page.getByLabel('Posten 2', { exact: true }).fill('Trinkgeld Platzwart');
  await page.getByLabel('Betrag Posten 2 in €').fill('3,3');
  await expect(page.getByTestId('eigenbeleg-summe')).toHaveText(/15,80\s€/);

  // Another reason has to be described
  await page.getByLabel('Anderer Grund').check();
  await download.click();
  await expect(page.getByLabel('Grund', { exact: true })).toBeFocused();
  await page.getByLabel('Grund', { exact: true }).fill('Automat ohne Quittungsdruck');
  await expectNoHorizontalOverflow(page);

  // Leaving with entries asks first
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Übersicht' })
    .click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(page).toHaveURL(/\/eigenbeleg$/);

  const pdfDownload = page.waitForEvent('download');
  await download.click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe('Eigenbeleg 2026-08-03 Parkhaus Oberjoch.pdf');
  const content = await readFile(await pdf.path());
  expect(content.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByText(/Der Eigenbeleg wurde heruntergeladen/)).toBeVisible();

  // After the download nothing is lost when leaving
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Übersicht' })
    .click();
  await expect(page).toHaveURL(/\/leitendenbereich\/?$/);
});

test('the Leihgebühren can be reset to no material', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=leihgebuehren');
  const reset = page.getByRole('button', { name: 'Zurücksetzen', exact: true });
  await expect(reset).toHaveCount(0);
  await page.getByLabel('Anzahl Kohte').fill('1');
  await page.getByLabel('Tage Kohte').fill('3');
  await expect(page.getByTestId('leihgebuehren-summe')).toHaveText(/45,00\s€/);

  // Cancelling keeps the entries
  await reset.click();
  await answerConfirm(page, 'Leihgebühren zurücksetzen?', 'Abbrechen');
  await expect(page.getByTestId('leihgebuehren-summe')).toHaveText(/45,00\s€/);

  await reset.click();
  await answerConfirm(page, 'Leihgebühren zurücksetzen?', 'Zurücksetzen');
  await expect(page.getByTestId('leihgebuehren-summe')).toHaveText(/0,00\s€/);
  await expect(page.getByLabel('Anzahl Kohte')).toHaveValue('0');
  await expect(page.getByLabel('Tage Kohte')).toHaveValue('10');
  await expect(page.getByTestId('tab-leihgebuehren-summe')).toHaveCount(0);
  await expect(reset).toHaveCount(0);
});

test('Neu laden exports the Einzelnachweise again and keeps the entries', async ({ page }) => {
  const first = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/intern/abrechnung/evt_Sola26'
  );
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const before = ((await (await first).json()) as { exportedAt: string }).exportedAt;
  // Opening the page uses the last export of the Playwright API
  expect((await first).url()).not.toContain('refresh');
  // The fixtures fix the clock at 2026-10-01, so the export of the server's today shows its date
  await expect(page.getByTestId('export-stand')).toContainText(
    /Stand: (\d{2}\.\d{2}\.\d{4}, )?\d{2}:\d{2} Uhr/
  );

  const zusatztag = page.getByRole('checkbox', { name: /Zusatztag/ });
  await zusatztag.check();
  const reloaded = page.waitForResponse((r) => r.url().includes('refresh=true'));
  await page.getByRole('button', { name: 'Neu laden' }).click();
  const after = ((await (await reloaded).json()) as { exportedAt: string }).exportedAt;
  expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  await expect(page.getByRole('button', { name: 'Neu laden' })).toBeEnabled();
  await expect(zusatztag).toBeChecked();
});

test('a new Leitende*r is confirmed inside the reopened dialog', async ({ page, request }) => {
  await page.goto('/leitendenbereich/leitende');
  await page.getByRole('button', { name: 'Neue Person', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = 'TEST – bitte löschen';
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(
    dialog.getByText(`${name} angelegt. Du kannst jetzt ein Foto hinzufügen.`)
  ).toBeVisible();
  await expect(dialog.getByText('Foto hochladen', { exact: true })).toBeVisible();
  const list = await (await request.get('/api/intern/pflege/leitende')).json();
  const created = list.items.find((person: { name: string }) => person.name === name);
  expect((await request.delete(`/api/intern/pflege/leitende/${created.id}`)).status()).toBe(204);
});

test('Neu laden reports success and keeps the last list when it fails', async ({ page }) => {
  await page.goto('/leitendenbereich/downloads');
  const reload = page.getByRole('button', { name: 'Neu laden', exact: true });
  await expect(reload).toBeEnabled();
  await reload.click();
  await expect(page.getByText('Liste aktualisiert.', { exact: true })).toBeVisible();
  await page.route('**/api/intern/pflege/downloads', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'UNAVAILABLE', code: 'UNAVAILABLE', message: 'Dienst nicht erreichbar.' },
    })
  );
  await reload.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Dienst nicht erreichbar.' })
  ).toContainText('Angezeigt wird der zuletzt geladene Stand.');
  await expect(page.getByRole('list').first()).toBeVisible();
});
