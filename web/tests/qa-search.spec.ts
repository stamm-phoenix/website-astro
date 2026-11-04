import { test, expect } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('search finds answer text, reports no matches and resets with the keyboard', async ({
  page,
}) => {
  await page.goto('/fragen-und-antworten');
  const search = page.getByRole('searchbox', { name: 'Fragen und Antworten durchsuchen' });
  await search.fill('Isomatte');
  await expect(page.getByRole('status')).toContainText('1 Frage gefunden');
  const question = page.getByRole('button', { name: 'Was muss mein Kind zum Lager mitnehmen?' });
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#antwort-5')).toContainText('Isomatte');
  await search.fill('Meerjungfrau');
  await expect(
    page.getByRole('heading', { name: 'Keine passenden Fragen gefunden' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Suche löschen' }).focus();
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(question).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('contact suggestions open in place and do not prevent sending', async ({ page }) => {
  await page.route('**/api/kontakt', (route) => route.fulfill({ json: { receipt: true } }));
  await page.goto('/kontakt');
  await page.getByLabel('Dein Name', { exact: true }).fill('Test Familie');
  await page.getByLabel('Deine E-Mail-Adresse').fill('familie@example.org');
  await page.getByLabel('Worum geht es?').selectOption('gruppenstunden');
  const message = page.getByLabel('Deine Nachricht');
  await message.fill('Hallo, kann mein Kind erst einmal schnuppern?');
  const suggestions = page.getByRole('region', { name: 'Passende Antworten' });
  await expect(suggestions).toBeVisible();
  await expect(suggestions.locator('summary')).toHaveCount(1);
  await suggestions.locator('summary').filter({ hasText: 'unverbindlich schnuppern' }).click();
  await expect(suggestions).toContainText('Schnupperzeitraum');
  await expect(message).toHaveValue('Hallo, kann mein Kind erst einmal schnuppern?');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  await expect(page.getByText('Danke für deine Nachricht!')).toBeVisible();
});

test('unavailable FAQ does not block writing or submitting a contact message', async ({ page }) => {
  await page.route('**/api/qa', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto('/kontakt');
  await page.getByLabel('Deine Nachricht').fill('Eine ganz andere Frage');
  await expect(page.getByRole('region', { name: 'Passende Antworten' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  await expect(page.getByLabel('Dein Name', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Deine Nachricht')).toHaveValue('Eine ganz andere Frage');
});
