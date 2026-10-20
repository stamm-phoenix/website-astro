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
