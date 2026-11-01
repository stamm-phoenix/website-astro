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
