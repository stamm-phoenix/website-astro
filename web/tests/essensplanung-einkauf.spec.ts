import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('the shopping list sums the dishes and extra needs, less the stock, by shop', async ({
  page,
}) => {
  // Many steps through four areas: more than the usual time
  test.slow();
  await anlegen(page, 'E2E Einkauf');
  const dialog = page.getByRole('dialog');

  // Pasta for 4: 500 g; 8 people eat it at lunch on both days
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Nudeln');
  await page.getByLabel('Personen', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Nudeln angelegt.').first()).toBeVisible();
  const nudeln = page.locator('li', { has: page.getByText('Nudeln', { exact: true }) }).first();
  await nudeln.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Nudeln (Spag');
  await dialog.getByRole('option', { name: 'Nudeln (Spaghetti)' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('500');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('g');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
  await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: 'Pfadi' });
  await dialog.getByLabel('Anzahl').fill('8');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('tab', { name: 'Plan' }).click();
  for (const mahlzeit of ['1_2', '2_2']) {
    await page.getByRole('button', { name: `Gericht einplanen bei ${mahlzeit}` }).click();
    await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Nudeln' });
    await dialog.getByRole('button', { name: 'Einplanen' }).click();
    await expect(dialog).toBeHidden();
  }

  // 2 × 1 kg pasta, without a shop yet
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  const ohne = page.getByRole('list', { name: 'Ohne Geschäft: Teigware' });
  await expect(ohne).toContainText('2 kg Nudeln (Spaghetti)');

  // 500 g are in stock, dish soap is needed on top
  await page.getByRole('button', { name: 'Bestand eintragen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Nudeln (Spag');
  await dialog.getByRole('option', { name: 'Nudeln (Spaghetti)' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('0,5');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('kg');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(dialog).toBeHidden();
  await expect(ohne).toContainText('1,5 kg Nudeln (Spaghetti)');

  await page.getByRole('button', { name: 'Zusatzbedarf eintragen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Spülmittel');
  await dialog.getByRole('option', { name: 'Spülmittel', exact: true }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(dialog.getByText('Bitte eine Menge größer 0 eintragen')).toBeVisible();
  await dialog.getByLabel('Menge', { exact: true }).fill('2,5');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(dialog).toBeHidden();
  // Pieces are rounded up for buying
  await expect(page.getByRole('list', { name: 'Ohne Geschäft: Reinigung/Hygiene' })).toContainText(
    '3 Stück Spülmittel'
  );

  // A shop, and the pasta is bought there
  await page.getByRole('button', { name: 'Geschäft hinzufügen' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Metro');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel('Geschäft für Nudeln (Spaghetti)').selectOption({ label: 'Metro' });
  await expect(page.getByRole('list', { name: 'Metro: Teigware' })).toContainText(
    '1,5 kg Nudeln (Spaghetti)'
  );
  await expectNoHorizontalOverflow(page);

  // Deleting the shop puts the pasta back without one
  await page.getByRole('button', { name: 'Geschäft Metro löschen' }).click();
  await answerConfirm(page, 'Metro löschen?', 'Löschen');
  await expect(ohne).toContainText('1,5 kg Nudeln (Spaghetti)');

  // Taking the stock away buys all of it again
  await page.getByRole('button', { name: '500 g Nudeln (Spaghetti) entfernen' }).click();
  await answerConfirm(page, '500 g Nudeln (Spaghetti) entfernen?', 'Entfernen');
  await expect(ohne).toContainText('2 kg Nudeln (Spaghetti)');
});
