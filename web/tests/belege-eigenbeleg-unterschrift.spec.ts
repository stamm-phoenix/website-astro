import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { BelegCheck } from '../../api/lib/beleg-check';

/** What the check answers for a photo of an Eigenbeleg without signature (#460). */
const unsignedCheck: BelegCheck = {
  ok: false,
  isReceipt: true,
  complete: true,
  readable: true,
  unsignedEigenbeleg: true,
  issues: ['Der Eigenbeleg ist nicht unterschrieben. Bitte unterschreiben und neu fotografieren.'],
  restrictedItems: [],
  shop: 'Parkautomat',
  date: '2026-09-30',
  amountCent: 600,
  checkedAt: '2026-10-01T12:00:00Z',
};

test('an unsigned Eigenbeleg is named before submitting and marked for the Kasse', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/belege/pruefung', (route) =>
    route.fulfill({ json: { available: true, check: unsignedCheck } })
  );
  await page.goto('/leitendenbereich/belege');
  // The demo Eigenbeleg of Kim was submitted without signature
  await expect(page.getByText('Nicht unterschrieben', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 900, 1200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'eigenbeleg.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  });
  const verdict = dialog.getByRole('note').filter({ hasText: 'Foto prüfen' });
  await expect(verdict).toContainText('Der Eigenbeleg ist nicht unterschrieben.');
  await expect(verdict).toContainText('Ohne Unterschrift lehnt die Kasse den Eigenbeleg ab.');
  await expect(verdict).not.toContainText('Einreichen geht trotzdem.');
  await expectNoHorizontalOverflow(page);
});
