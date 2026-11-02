import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import type { Page } from '@playwright/test';
import { anlegen, pdfLaden } from './essensplanung-helpers';

/** The form of a new receipt. */
const neu = (page: Page) => page.getByRole('region', { name: 'Neuer Beleg' });

/** A photo of a receipt on a dark table, drawn in the browser. */
async function belegFoto(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3a3027';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f4f1ea';
    context.fillRect(200, 150, 600, 1100);
    context.fillStyle = '#222';
    context.font = '32px sans-serif';
    for (let line = 0; line < 18; line++)
      context.fillText(`Artikel ${line}  1,99`, 240, 220 + line * 52);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

test('receipts with and without photo; who gets how much back; as PDF', async ({ page }) => {
  await anlegen(page, 'E2E Belege');
  await page.getByRole('tab', { name: 'Belege' }).click();
  await expect(page.getByText('Noch keine Belege eingetragen.')).toBeVisible();

  // With a photo: the camera or file choice opens at once, the check fills the fields
  const auswahl = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Beleg mit Foto' }).click();
  await (
    await auswahl
  ).setFiles({ name: 'bon.jpg', mimeType: 'image/jpeg', buffer: await belegFoto(page) });
  await expect(page.getByAltText('Vorschau des Fotos')).toBeVisible();
  await expect(neu(page).getByLabel('Händler oder was')).toHaveValue('Demo-Markt');
  await expect(neu(page).getByLabel('Betrag in €')).toHaveValue('23,45');
  await expect(neu(page).getByLabel('Bezahlt von', { exact: true })).toHaveValue(/^m:/);
  await page.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  // By hand, paid by someone else
  await page.getByRole('button', { name: 'Ohne Foto eintragen' }).click();
  await neu(page).getByLabel('Betrag in €').fill('14,50');
  await neu(page).getByLabel('Händler oder was').fill('Gas für den Kocher');
  await neu(page).getByLabel('Bezahlt von', { exact: true }).selectOption('text');
  const name = neu(page).getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await name.fill('Oma Inge');
  await page.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  const tabelle = page.getByTestId('belege-tabelle');
  await expect(tabelle.locator('tbody tr')).toHaveCount(2);
  const statistik = page.getByTestId('belege-statistik');
  await expect(statistik).toContainText('Kim Küche');
  await expect(statistik).toContainText('Oma Inge');
  await expect(statistik.locator('tfoot')).toContainText('37,95');

  // Paid back: counts in the totals only
  // Newest first: the receipt typed in by hand is on top
  const gas = tabelle.locator('tbody tr').first();
  await expect(gas.getByRole('textbox', { name: /^Händler oder was/ })).toHaveValue(
    'Gas für den Kocher'
  );
  await gas.getByRole('checkbox').check();
  await expect(page.getByText('Als erstattet markiert.').first()).toBeVisible();
  await expect(statistik.locator('tfoot')).toContainText('23,45');
  await page.getByRole('button', { name: /^Zu erstatten/ }).click();
  await expect(tabelle.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: /^Alle/ }).click();

  // Changing in the row: the amount saves on Enter
  const betrag = gas.getByRole('textbox', { name: /^Betrag in €/ });
  await betrag.fill('15,00');
  await betrag.press('Enter');
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();
  await expect(statistik.locator('tfoot')).toContainText('38,45');

  // The photo opens big
  await tabelle.getByRole('button', { name: 'Foto des Belegs ansehen' }).click();
  await expect(page.getByRole('dialog').getByAltText('Foto des Belegs')).toBeVisible();
  await page.keyboard.press('Escape');
  await expectNoHorizontalOverflow(page);

  const pdf = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Belege als PDF' }).click()
  );
  expect(pdf.name).toBe('Belege E2E Belege.pdf');
  expect(pdf.text).toContain('Noch zu erstatten');
  expect(pdf.text).toContain('Oma Inge');
  expect(pdf.text).toContain('Demo-Markt');
  expect(pdf.seiten).toBe(2);

  // Deleting asks first
  await gas.getByRole('button', { name: /löschen$/ }).click();
  await answerConfirm(page, 'Beleg Gas für den Kocher über 15,00\u00a0€ löschen?', 'Löschen');
  await expect(tabelle.locator('tbody tr')).toHaveCount(1);
});

test('the read-only link sees receipts and the PDF, but changes nothing', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Belege lesen');
  await page.getByRole('tab', { name: 'Belege' }).click();
  await page.getByRole('button', { name: 'Ohne Foto eintragen' }).click();
  await neu(page).getByLabel('Betrag in €').fill('9,99');
  await neu(page).getByLabel('Händler oder was').fill('Bäcker');
  await page.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).nth(1).click();
  const links = page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/planung#t=' });
  await expect(links).toHaveCount(2);
  const lesen = (await links.last().textContent())!.trim();
  const leser = await (await browser.newContext()).newPage();
  await leser.goto(lesen);
  await leser.getByRole('tab', { name: 'Belege' }).click();
  await expect(leser.getByTestId('belege-tabelle')).toContainText('Bäcker');
  await expect(leser.getByTestId('belege-tabelle')).toContainText('offen');
  await expect(leser.getByRole('checkbox')).toHaveCount(0);
  await expect(leser.getByRole('button', { name: 'Ohne Foto eintragen' })).toHaveCount(0);
  await expect(leser.getByRole('button', { name: 'Belege als PDF' })).toBeVisible();
  await leser.context().close();
});
