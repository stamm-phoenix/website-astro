import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { anlegen } from './essensplanung-helpers';

/** A plain receipt photo in one colour, drawn in the browser. */
async function belegFoto(page: Page, farbe: string): Promise<Buffer> {
  const bytes = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, farbe);
  return Buffer.from(bytes);
}

/** Opens „Foto ändern“ of the first receipt and chooses a photo, without saving it. */
async function fotoVorbereiten(page: Page, farbe: string): Promise<void> {
  const auswahl = page.waitForEvent('filechooser');
  await page
    .getByTestId('belege-tabelle')
    .getByRole('button', { name: /^Foto ersetzen/ })
    .click();
  await (
    await auswahl
  ).setFiles({ name: 'bon.jpg', mimeType: 'image/jpeg', buffer: await belegFoto(page, farbe) });
  await expect(page.getByAltText('Vorschau des Fotos')).toBeVisible();
}

test('a photo replaced by someone else meanwhile is not overwritten without asking', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await anlegen(page, 'E2E Belege Fotokonflikt');
  await page.getByRole('tab', { name: 'Belege' }).click();
  // A receipt with a photo to start with
  const auswahl = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Beleg mit Foto' }).click();
  await (
    await auswahl
  ).setFiles({ name: 'bon.jpg', mimeType: 'image/jpeg', buffer: await belegFoto(page, '#eeeeee') });
  await expect(page.getByAltText('Vorschau des Fotos')).toBeVisible();
  const neu = page.getByRole('region', { name: 'Neuer Beleg' });
  // The check fills the amount
  await expect(neu.getByLabel('Betrag in €')).toHaveValue('23,45');
  await neu.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  // A prepares a new photo, B replaces it first
  await fotoVorbereiten(page, '#ddeeff');
  const b = await (await browser.newContext()).newPage();
  await b.goto(page.url());
  await b.getByRole('tab', { name: 'Belege' }).click();
  await fotoVorbereiten(b, '#ffeedd');
  await b.getByRole('button', { name: 'Foto speichern' }).click();
  await expect(b.getByText('Foto gespeichert.').first()).toBeVisible();
  await b.context().close();

  // A's page learns of it by polling; saving still refuses to overwrite B's photo
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: 'Foto speichern' }).click();
  await expect(page.getByText(/Jemand anderes hat/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByAltText('Vorschau des Fotos')).toBeVisible();
  // Only the confirmed second click saves over it
  await page.getByRole('button', { name: 'Trotzdem speichern' }).click();
  await expect(page.getByText('Foto gespeichert.').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByAltText('Vorschau des Fotos')).toHaveCount(0);
});

test('a payer typed while someone else changed it saves only after the conflict', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anlegen(page, 'E2E Belege Zahlerkonflikt');
  await page.getByRole('tab', { name: 'Belege' }).click();
  await page.getByRole('button', { name: 'Ohne Foto eintragen' }).click();
  const neu = page.getByRole('region', { name: 'Neuer Beleg' });
  await neu.getByLabel('Betrag in €').fill('5,00');
  await neu.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  // A starts typing someone else as payer, without leaving the field
  const zeile = (seite: Page) => seite.getByTestId('belege-tabelle').locator('tbody tr').first();
  await zeile(page)
    .getByRole('combobox', { name: /^Bezahlt von/ })
    .selectOption('text');
  const nameA = zeile(page).getByRole('textbox', { name: /^Bezahlt von.*: Name$/ });
  await nameA.fill('Oma Inge');

  // B sets another payer meanwhile; B sends directly, so A's field keeps its focus
  const token = /[#&]t=([^&]+)/.exec(page.url())![1];
  const headers = { 'x-essensplanung-token': token };
  const ansicht = await (await page.request.get('/api/essensplanung/planung', { headers })).json();
  const beleg = ansicht.belege[0];
  const antwort = await page.request.patch(`/api/essensplanung/planung/belege/${beleg.id}`, {
    headers,
    data: { etag: beleg.etag, bezahltVonId: null, bezahltVonText: 'Ben' },
  });
  expect(antwort.status()).toBe(200);

  // A's page hears of it; saving the typed name is a conflict, and the name stays
  await page.waitForTimeout(4000);
  await nameA.press('Enter');
  await expect(page.getByText(/Jemand anderes hat/).first()).toBeVisible({ timeout: 15_000 });
  await expect(nameA).toHaveValue('Oma Inge');
  // Saving again goes on the version now shown
  await nameA.press('Enter');
  await expect(page.getByTestId('belege-statistik')).toContainText('Oma Inge', {
    timeout: 15_000,
  });
});

test('after a failed save a change of someone else still is a conflict', async ({ page }) => {
  test.setTimeout(90_000);
  await anlegen(page, 'E2E Belege Fehler dann Konflikt');
  await page.getByRole('tab', { name: 'Belege' }).click();
  await page.getByRole('button', { name: 'Ohne Foto eintragen' }).click();
  const neu = page.getByRole('region', { name: 'Neuer Beleg' });
  await neu.getByLabel('Betrag in €').fill('5,00');
  await neu.getByLabel('Händler oder was').fill('Rewe');
  await neu.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  // A's change fails at the server once
  const zeile = page.getByTestId('belege-tabelle').locator('tbody tr').first();
  const haendler = zeile.getByRole('textbox', { name: /^Händler oder was/ });
  await page.route(
    /\/api\/essensplanung\/planung\/belege\/\d+$/,
    (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'SERVER', message: 'Serverfehler (Test).' }),
          })
        : route.continue(),
    { times: 1 }
  );
  await haendler.fill('Aldi');
  await haendler.press('Enter');
  await expect(page.getByText('Serverfehler (Test).').first()).toBeVisible();
  await expect(haendler).toHaveValue('Aldi');

  // B changes the shop meanwhile; A's page hears of it
  const token = /[#&]t=([^&]+)/.exec(page.url())![1];
  const headers = { 'x-essensplanung-token': token };
  const ansicht = await (await page.request.get('/api/essensplanung/planung', { headers })).json();
  const beleg = ansicht.belege[0];
  const antwort = await page.request.patch(`/api/essensplanung/planung/belege/${beleg.id}`, {
    headers,
    data: { etag: beleg.etag, haendler: 'Lidl' },
  });
  expect(antwort.status()).toBe(200);
  await page.waitForTimeout(4000);

  // Saving again is a conflict, not a silent overwrite of B's change; the input stays
  await haendler.press('Enter');
  await expect(page.getByText(/Jemand anderes hat/).first()).toBeVisible({ timeout: 15_000 });
  await expect(haendler).toHaveValue('Aldi');
  // Only a further, deliberate Enter saves over it
  await haendler.press('Enter');
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.getByRole('tab', { name: 'Belege' }).click();
  await expect(
    page
      .getByTestId('belege-tabelle')
      .locator('tbody tr')
      .first()
      .getByRole('textbox', { name: /^Händler oder was/ })
  ).toHaveValue('Aldi');
});
