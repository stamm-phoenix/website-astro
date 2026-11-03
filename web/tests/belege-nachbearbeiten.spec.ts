import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the Kasse crops a stored receipt photo again and keeps its original', async ({
  page,
}, testInfo) => {
  const uploads: { photo: string; original?: string }[] = [];
  await page.route('**/api/intern/pflege/belege/*/foto*', async (route) => {
    if (route.request().method() === 'PUT') uploads.push(route.request().postDataJSON());
    await route.fallback();
  });
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: /REWE/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Beleg von/ });

  // A white receipt on a dark table, found and cropped when it is chosen
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 900, 1200);
    context.fillStyle = '#fff';
    context.fillRect(150, 150, 600, 900);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'beleg.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await dialog.getByRole('button', { name: 'Neues Foto speichern', exact: true }).click();
  await expect(dialog.getByText('Foto ersetzt.', { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].original).toBeTruthy();

  // The stored photo opens with the tools; unchanged, there is nothing to save
  await dialog.getByRole('button', { name: 'Foto bearbeiten', exact: true }).click();
  const preview = dialog.getByAltText('Vorschau des Fotos');
  await expect(preview).toBeVisible();
  await expect(dialog.getByRole('toolbar', { name: 'Foto bearbeiten' })).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Bearbeitetes Foto speichern', exact: true });
  await expect(save).toBeDisabled();
  const before = Number(await preview.getAttribute('width'));

  await dialog.getByRole('button', { name: 'Zuschneiden', exact: true }).click();
  await dialog
    .getByRole('button', { name: /Ecke oben links verschieben/ })
    .press('Shift+ArrowRight');
  await dialog
    .getByRole('button', { name: /Ecke unten links verschieben/ })
    .press('Shift+ArrowRight');
  await dialog.getByRole('button', { name: 'Zuschneiden fertig' }).click();
  await expect.poll(async () => Number(await preview.getAttribute('width'))).toBeLessThan(before);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('nachbearbeiten.png') });

  await save.click();
  await expect(dialog.getByText('Bearbeitetes Foto gespeichert.', { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  expect(uploads).toHaveLength(2);
  // The new crop replaces the photo; the original taken by the submitter stays
  expect(uploads[1].photo).not.toBe(uploads[0].photo);
  expect(uploads[1].original).toBe(uploads[0].original);
});

test('editing a stored photo can be discarded without saving', async ({ page }) => {
  let puts = 0;
  await page.route('**/api/intern/pflege/belege/*/foto*', async (route) => {
    if (route.request().method() === 'PUT') puts++;
    await route.fallback();
  });
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: /REWE/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Beleg von/ });
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 900, 1200);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'beleg.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await dialog.getByRole('button', { name: 'Neues Foto speichern', exact: true }).click();
  await expect(dialog.getByText('Foto ersetzt.', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Foto bearbeiten', exact: true }).click();
  await dialog.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Bearbeitetes Foto speichern', exact: true })
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(dialog.getByAltText(/Foto des Belegs/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Foto bearbeiten', exact: true })).toBeVisible();
  expect(puts).toBe(1);
});

test('saving the receipt with an unchanged or reset stored photo keeps its original', async ({
  page,
}) => {
  const uploads: { photo: string; original?: string }[] = [];
  await page.route('**/api/intern/pflege/belege/*/foto*', async (route) => {
    if (route.request().method() === 'PUT') uploads.push(route.request().postDataJSON());
    await route.fallback();
  });
  await page.goto('/leitendenbereich/belege');
  const open = page.getByRole('button', { name: /REWE/ }).first();
  await open.click();
  const dialog = page.getByRole('dialog', { name: /Beleg von/ });
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 900, 1200);
    context.fillStyle = '#fff';
    context.fillRect(150, 150, 600, 900);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'beleg.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await dialog.getByRole('button', { name: 'Neues Foto speichern', exact: true }).click();
  await expect(dialog.getByText('Foto ersetzt.', { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(1);

  // Opened, turned and reset, then the receipt is saved: the photo is not sent again
  await dialog.getByRole('button', { name: 'Foto bearbeiten', exact: true }).click();
  await dialog.getByRole('button', { name: 'Nach rechts drehen' }).click();
  const reset = dialog.getByRole('button', { name: 'Auf das gespeicherte Foto zurücksetzen' });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(uploads).toHaveLength(1);

  // The original is still there
  await open.click();
  await expect(dialog.getByRole('link', { name: 'Original ansehen' })).toBeVisible();
});

test('without the Kasse an accepted receipt offers no photo editing', async ({ page }) => {
  await page.route('**/api/intern/pflege/belege/rolle', (route) =>
    route.fulfill({ json: { reviewer: false } })
  );
  const records = (await (await page.request.get('/api/intern/pflege/belege')).json()) as {
    shop: string;
    status: string;
    hasImage: boolean;
    isPdf: boolean;
    readOnly?: boolean;
  }[];
  const accepted = records.find(
    (item) => item.status === 'Angenommen' && item.hasImage && !item.isPdf && !item.readOnly
  )!;
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button').filter({ hasText: accepted.shop }).first().click();
  const dialog = page.getByRole('dialog', { name: /Beleg von/ });
  await expect(dialog.getByAltText(/Foto des Belegs/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Foto bearbeiten', exact: true })).toHaveCount(0);
});

test('an unchanged stored photo does not hold up the transfer to CampFlow', async ({ page }) => {
  let uploads = 0;
  let transferred = 0;
  await page.route('**/api/intern/pflege/belege/*/foto*', async (route) => {
    if (route.request().method() === 'PUT') uploads++;
    await route.fallback();
  });
  // Answered here, so the shared demo keeps its receipt for the other tests
  await page.route('**/api/intern/pflege/belege/*/campflow', async (route) => {
    transferred++;
    await route.fulfill({
      json: {
        campflow: { state: 'Hochgeladen', number: '2026-120' },
        created: true,
        deleted: true,
      },
    });
  });
  await page.route('**/api/intern/pflege/belege/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await route.fulfill({ json: { mailed: false, etag: 'gespeichert' } });
  });
  await page.goto('/leitendenbereich/belege');
  await page
    .getByRole('button', { name: /Deutsche Bahn/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von Deutsche Bahn' });
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 900, 1200);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'beleg.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await dialog.getByRole('button', { name: 'Neues Foto speichern', exact: true }).click();
  await expect(dialog.getByText('Foto ersetzt.', { exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Foto bearbeiten', exact: true }).click();
  await dialog.getByRole('button', { name: 'Nach rechts drehen' }).click();
  const reset = dialog.getByRole('button', { name: 'Auf das gespeicherte Foto zurücksetzen' });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
  await dialog.getByRole('button', { name: 'Nach CampFlow übertragen', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(transferred).toBe(1);
  expect(uploads).toBe(1);
});
