import { test, expect } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';

test('plan, recipe cards, eaters and shopping list download as PDF', async ({ page }) => {
  // Many steps through four areas: more than the usual time
  test.slow();
  await anlegen(page, 'E2E PDF');
  const dialog = page.getByRole('dialog');

  // Pasta for 4: 500 g and salt to taste; 8 Pfadis eat it at lunch on day 1
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
  await nudeln.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Salz');
  await dialog.getByRole('option', { name: 'Salz', exact: true }).click();
  await dialog.getByLabel('Hinweis (optional)').fill('ins Wasser');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();

  const karte = await pdfLaden(page, () =>
    nudeln.getByRole('button', { name: 'Rezeptkarte als PDF: Nudeln' }).click()
  );
  expect(karte.name).toBe('Rezeptkarte Nudeln.pdf');
  expect(karte.text).toContain('Für 4 Personen');
  expect(karte.text).toContain('Nudeln (Spaghetti)');
  expect(karte.text).toContain('500 g');
  expect(karte.text).toContain('nach Gefühl');
  expect(karte.text).toContain('ins Wasser');
  // A long name wraps on the card instead of running off the page
  const lang = `Nudeln ${'mit sehr viel Soße '.repeat(6).trim()} Ende`;
  await page.getByLabel('Neues Gericht').fill(lang);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`${lang} angelegt.`).first()).toBeVisible();
  const langeKarte = await pdfLaden(page, () =>
    page.getByRole('button', { name: `Rezeptkarte als PDF: ${lang}` }).click()
  );
  expect(langeKarte.breiteste).toBeLessThanOrEqual(210 - 14 + 0.5);
  const alle = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Alle Rezeptkarten als PDF' }).click()
  );
  expect(alle.name).toBe('Rezeptkarten E2E PDF.pdf');

  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
  await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: 'Pfadi' });
  await dialog.getByLabel('Anzahl').fill('8');
  await dialog.getByLabel('Hinweis (optional)').fill('kommen mit dem Zug');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();
  const esser = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Esser je Mahlzeit als PDF' }).click()
  );
  expect(esser.name).toBe('Esser je Mahlzeit E2E PDF.pdf');
  expect(esser.text).toContain('Tag 1');
  expect(esser.text).toContain('8 Personen');
  expect(esser.text).toContain('Pfadi');
  expect(esser.text).toContain('kommen mit dem Zug');

  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Nudeln' });
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(dialog).toBeHidden();
  const plan = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Plan als PDF' }).click()
  );
  expect(plan.name).toBe('Plan E2E PDF.pdf');
  expect(plan.text).toContain('Nudeln: 8 Portionen');
  expect(plan.text).toContain('1 kg');

  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(page.getByRole('list', { name: 'Ohne Geschäft: Teigware' })).toContainText(
    '1 kg Nudeln (Spaghetti)'
  );
  const liste = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Einkaufsliste als PDF' }).click()
  );
  expect(liste.name).toBe('Einkaufsliste E2E PDF.pdf');
  expect(liste.text).toContain('Ohne Geschäft');
  expect(liste.text).toContain('Teigware');
  expect(liste.text).toContain('Nudeln (Spaghetti)');
  expect(liste.text).toContain('nach Gefühl');
});
