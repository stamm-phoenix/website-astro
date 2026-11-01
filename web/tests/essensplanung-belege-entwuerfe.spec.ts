import { test, expect, answerConfirm } from './fixtures';
import type { Page } from '@playwright/test';
import { anlegen } from './essensplanung-helpers';

const neu = (page: Page) => page.getByRole('region', { name: 'Neuer Beleg' });

/** A small receipt photo, drawn in the browser. */
async function belegFoto(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f4f1ea';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

test('a double click saves one receipt, also while the photo is still being checked', async ({
  page,
}) => {
  await anlegen(page, 'E2E Belege doppelt');
  await page.getByRole('tab', { name: 'Belege' }).click();
  // The check answers late, so saving waits for it
  await page.route('**/api/essensplanung/planung/belege/pruefung*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/planung\/belege$/.test(request.url())) posts++;
  });
  const auswahl = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Beleg mit Foto' }).click();
  await (
    await auswahl
  ).setFiles({ name: 'bon.jpg', mimeType: 'image/jpeg', buffer: await belegFoto(page) });
  await expect(page.getByAltText('Vorschau des Fotos')).toBeVisible();

  // While the crop tool is open, the receipt cannot be saved with the old picture
  await neu(page).getByLabel('Betrag in €').fill('7,50');
  await neu(page).getByRole('button', { name: 'Zuschneiden', exact: true }).click();
  await expect(neu(page).getByRole('button', { name: 'Beleg speichern' })).toBeDisabled();
  await neu(page).getByRole('button', { name: 'Abbrechen', exact: true }).first().click();

  const speichern = neu(page).getByRole('button', { name: 'Beleg speichern' });
  await speichern.dblclick();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('belege-tabelle').locator('tbody tr')).toHaveCount(1);
  expect(posts).toBe(1);
});

test('switching the kind keeps what is typed; drafts of rows survive the filter', async ({
  page,
}) => {
  await anlegen(page, 'E2E Belege Entwürfe');
  await page.getByRole('tab', { name: 'Belege' }).click();
  await page.getByRole('button', { name: 'Ohne Foto eintragen' }).click();
  await neu(page).getByLabel('Betrag in €').fill('3,20');
  await neu(page).getByLabel('Händler oder was').fill('Bäcker');

  // To the photo and back: the fields stay; a chosen photo goes only after asking
  const auswahl = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Beleg mit Foto' }).click();
  await (
    await auswahl
  ).setFiles({ name: 'bon.jpg', mimeType: 'image/jpeg', buffer: await belegFoto(page) });
  await expect(page.getByAltText('Vorschau des Fotos')).toBeVisible();
  await expect(neu(page).getByLabel('Händler oder was')).toHaveValue(/Bäcker|Demo-Markt/);
  await page.getByRole('button', { name: 'Ohne Foto eintragen' }).click();
  await answerConfirm(page, 'Foto verwerfen?', 'Foto verwerfen');
  await expect(page.getByAltText('Vorschau des Fotos')).toHaveCount(0);
  await expect(neu(page).getByLabel('Betrag in €')).toHaveValue('3,20');
  await neu(page).getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  // A rejected amount stays in the row, also after the filter hid it
  const zeile = page.getByTestId('belege-tabelle').locator('tbody tr').first();
  const betrag = zeile.getByRole('textbox', { name: /^Betrag in €/ });
  await betrag.fill('abc');
  await betrag.press('Enter');
  await expect(betrag).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: /^Erstattet/ }).click();
  await page.getByRole('button', { name: /^Alle/ }).click();
  await expect(
    page
      .getByTestId('belege-tabelle')
      .locator('tbody tr')
      .first()
      .getByRole('textbox', {
        name: /^Betrag in €/,
      })
  ).toHaveValue('abc');
});
