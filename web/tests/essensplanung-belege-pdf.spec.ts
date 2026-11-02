import { test, expect } from './fixtures';
import { anlegen } from './essensplanung-helpers';
import { rechnung } from './pdf-rechnung';

test('a receipt PDF of the Essensplanung is checked and shown with every page', async ({
  page,
}) => {
  await anlegen(page, 'E2E PDF-Beleg');
  await page.getByRole('tab', { name: 'Belege' }).click();

  const pruefung = page.waitForRequest((request) =>
    request.url().endsWith('/api/essensplanung/planung/belege/pruefung')
  );
  const auswahl = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Beleg mit Foto' }).click();
  await (
    await auswahl
  ).setFiles({ name: 'Rechnung.pdf', mimeType: 'application/pdf', buffer: rechnung() });
  await expect(page.getByAltText('Seite 2 von 3 des PDFs')).toBeVisible();
  // The check reads all three pages together
  expect(((await pruefung).postDataJSON() as { pages?: string[] }).pages).toHaveLength(3);
  await expect(
    page.getByRole('region', { name: 'Neuer Beleg' }).getByLabel('Betrag in €')
  ).toHaveValue('23,45');
  await page.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  // The stored PDF opens with all its pages
  await page
    .getByTestId('belege-tabelle')
    .getByRole('button', { name: 'PDF des Belegs ansehen' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByAltText('Erste Seite des PDFs des Belegs')).toBeVisible();
  await expect(dialog.getByAltText('Seite 2 von 3 des PDFs')).toBeVisible();
  await expect(dialog.getByAltText('Seite 3 von 3 des PDFs')).toBeAttached();
});
