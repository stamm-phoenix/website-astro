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
  // A stored receipt opens to look at; the photo is changed while editing
  await dialog.getByRole('button', { name: 'Bearbeiten', exact: true }).click();

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
  // The photo to crop starts below the label, as big as the other previews allow
  const original = await dialog.getByAltText('Originalfoto mit dem erkannten Beleg').boundingBox();
  const label = await dialog.getByText('Foto oder PDF des Belegs', { exact: true }).boundingBox();
  expect(original!.y).toBeGreaterThanOrEqual(label!.y + label!.height);
  expect(original!.height).toBeGreaterThan(400);
  await dialog
    .getByRole('button', { name: /Ecke oben links verschieben/ })
    .press('Shift+ArrowRight');
  await dialog
    .getByRole('button', { name: /Ecke unten links verschieben/ })
    .press('Shift+ArrowRight');
  // A rectangle around a small part, like a ticket on a large photo
  await dialog.getByRole('button', { name: 'Rechteck', exact: true }).click();
  for (let step = 0; step < 6; step++) {
    await dialog.getByRole('button', { name: /Rechten Rand verschieben/ }).press('Shift+ArrowLeft');
    await dialog.getByRole('button', { name: /Unteren Rand verschieben/ }).press('Shift+ArrowUp');
  }
  await dialog.getByRole('button', { name: 'Zuschneiden fertig' }).click();
  await expect.poll(async () => Number(await preview.getAttribute('width'))).not.toBe(before);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('nachbearbeiten.png') });

  await save.click();
  await expect(dialog.getByText('Bearbeitetes Foto gespeichert.', { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  expect(uploads).toHaveLength(2);
  // The new crop replaces the photo; the original taken by the submitter stays
  expect(uploads[1].photo).not.toBe(uploads[0].photo);
  expect(uploads[1].original).toBe(uploads[0].original);
  // The stored photo was big enough: its small crop is enlarged, so the API accepts it
  const size = await page.evaluate(async (photo) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${photo}`)).blob();
    const bitmap = await createImageBitmap(blob);
    return Math.max(bitmap.width, bitmap.height);
  }, uploads[1].photo);
  expect(size).toBeGreaterThanOrEqual(800);
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
  // A stored receipt opens to look at; the photo is changed while editing
  await dialog.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
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
  await dialog.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
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
  // Saved, the receipt is shown again to look at
  await expect(dialog.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  expect(uploads).toHaveLength(1);

  // The original is still there
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

test('editing the stored photo clears the message of a refused replacement', async ({ page }) => {
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: /REWE/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Beleg von/ });
  // A stored receipt opens to look at; the photo is changed while editing
  await dialog.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const photo = async (width: number, height: number) =>
    page.evaluate(
      async ([w, h]) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, w, h);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png')
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      [width, height]
    );
  const input = dialog.locator('input[type=file]');
  await input.setInputFiles({
    name: 'beleg.png',
    mimeType: 'image/png',
    buffer: Buffer.from(await photo(900, 1200)),
  });
  await dialog.getByRole('button', { name: 'Neues Foto speichern', exact: true }).click();
  await expect(dialog.getByText('Foto ersetzt.', { exact: true })).toBeVisible();

  await input.setInputFiles({
    name: 'klein.png',
    mimeType: 'image/png',
    buffer: Buffer.from(await photo(200, 280)),
  });
  const tooSmall = dialog.getByText(/Das Foto ist zu klein/);
  await expect(tooSmall).toBeVisible();
  await dialog.getByRole('button', { name: 'Foto bearbeiten', exact: true }).click();
  await expect(dialog.getByAltText('Vorschau des Fotos')).toBeVisible();
  await expect(tooSmall).toHaveCount(0);
});
