import { rechnung } from './pdf-rechnung';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { quiet } from './settle';

test('every page of a PDF is shown and checked, not only the first', async ({ page }, testInfo) => {
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).click();

  const pruefung = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/intern/pflege/belege/pruefung') && request.method() === 'POST'
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'Rechnung.pdf', mimeType: 'application/pdf', buffer: rechnung() });
  await expect(page.getByAltText('Erste Seite des PDFs')).toBeVisible();
  await expect(page.getByAltText('Seite 2 von 3 des PDFs')).toBeVisible();
  await expect(page.getByAltText('Seite 3 von 3 des PDFs')).toBeAttached();
  // The check reads all three pages together
  const sent = (await pruefung).postDataJSON() as { pages?: string[] };
  expect(sent.pages).toHaveLength(3);
  await expect(page.getByLabel('Geschäft')).toHaveValue('Demo-Markt');

  const shop = `PDF-Markt ${testInfo.project.name}`;
  await page.getByLabel('Geschäft').fill(shop);
  await page.getByLabel('Betrag in €').fill('119,40');
  await page
    .getByRole('dialog')
    .getByLabel('Kostenstelle', { exact: true })
    .fill('Wölflings-Herbstwochenende');
  await page
    .getByRole('dialog')
    .getByLabel('Kategorie', { exact: true })
    .fill('Verpflegungskosten');
  await page.getByRole('dialog').getByLabel('Kategorie', { exact: true }).press('Escape');
  await page
    .getByRole('radio', { name: 'Privat ausgelegt – an diese Person auszahlen', exact: true })
    .check();
  const submit = page.waitForRequest(
    (request) => request.url().endsWith('/api/intern/pflege/belege') && request.method() === 'POST'
  );
  await page.getByRole('button', { name: 'Einreichen', exact: true }).click();
  const body = (await submit).postDataJSON() as { pdf?: string; pages?: string[] };
  // The PDF goes as it is, with the further pages for the check
  expect(
    Buffer.from(body.pdf ?? '', 'base64')
      .subarray(0, 5)
      .toString('latin1')
  ).toBe('%PDF-');
  expect(body.pages).toHaveLength(2);
  await expect(page.getByText(/über 119,40\s€ eingereicht/).first()).toBeVisible();

  // The Kasse sees every page of the stored PDF too
  await page.getByRole('button', { name: new RegExp(shop) }).click();
  await expect(page.getByAltText(`Erste Seite des PDFs von ${shop}`)).toBeVisible();
  await expect(page.getByAltText('Seite 2 von 3 des PDFs')).toBeVisible();
  await expect(page.getByAltText('Seite 3 von 3 des PDFs')).toBeAttached();
  await expectNoHorizontalOverflow(page);

  // An expired login while loading the further pages offers the new login
  await page.keyboard.press('Escape');
  await page.route('**/api/intern/pflege/belege/*/foto?*download=1*', (route) =>
    route.fulfill({ status: 401, body: '' })
  );
  await page.getByRole('button', { name: new RegExp(shop) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Deine Anmeldung ist abgelaufen.');
  await expect(dialog.getByRole('link', { name: /Neu anmelden/ })).toBeVisible();
});

test('a late answer for a photo is ignored once a PDF is chosen instead', async ({ page }) => {
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).click();

  // The question how to turn the photo hangs until the PDF is chosen
  let antworten: () => void = () => undefined;
  const gehalten = new Promise<void>((resolve) => (antworten = resolve));
  let drehungGefragt: () => void = () => undefined;
  const gefragt = new Promise<void>((resolve) => (drehungGefragt = resolve));
  await page.route('**/api/intern/pflege/belege/pruefung?nur=drehung', async (route) => {
    drehungGefragt();
    await gehalten;
    await route.fulfill({ json: { available: true, rotation: 0 } });
  });
  const pruefungen: { pages?: string[] }[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/intern/pflege/belege/pruefung')) {
      pruefungen.push((request.postDataJSON() as { pages?: string[] } | null) ?? {});
    }
  });

  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f4f1ea';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: 'beleg.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(photo),
  });
  await gefragt;
  await input.setInputFiles({
    name: 'Rechnung.pdf',
    mimeType: 'application/pdf',
    buffer: rechnung(),
  });
  await expect(page.getByAltText('Seite 2 von 3 des PDFs')).toBeVisible();
  antworten();

  // Only the PDF is checked, with its own three pages
  await expect(page.getByLabel('Geschäft')).toHaveValue('Demo-Markt');
  await quiet(page);
  expect(pruefungen.map((body) => body.pages?.length ?? 1)).toEqual([3]);
});
