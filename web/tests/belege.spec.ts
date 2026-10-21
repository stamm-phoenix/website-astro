import { test, expect } from './fixtures';

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
  await expect(dialog.getByText('Anderes Foto wählen')).toBeVisible();

  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toBeVisible();
});

test('the Kasse transfers an accepted receipt to CampFlow with the chosen Kategorie', async ({
  page,
}) => {
  // Answered here, so the shared demo keeps its receipt for the other tests
  let sent: Record<string, unknown> | undefined;
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
  const accepted = page.getByRole('button', { name: /^Angenommen/ });
  // The counts appear once the list is loaded and the filter works
  await expect(accepted).toContainText('1');
  await accepted.click();
  await page.getByRole('button', { name: /Deutsche Bahn/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von Deutsche Bahn' });

  // The Kostenstelle named like the Aktion is preselected; the Kategorie is the Kasse's choice
  const transfer = dialog.getByRole('button', { name: 'Nach CampFlow übertragen' });
  await expect(dialog.getByLabel('Kostenstelle')).toHaveValue('cun_Sola26');
  await expect(transfer).toBeDisabled();
  await dialog.getByLabel('Kategorie').selectOption({ label: 'Fahrtkosten' });
  await transfer.click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(
      'Beleg von Deutsche Bahn ist in CampFlow als 2026-112 gebucht und wurde hier gelöscht.'
    )
  ).toBeVisible();
  expect(sent).toMatchObject({ costUnitId: 'cun_Sola26', categoryId: 'cat_Sola262' });
  expect(sent?.etag).toBeTruthy();
});
