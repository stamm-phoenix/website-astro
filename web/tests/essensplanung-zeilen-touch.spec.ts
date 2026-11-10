import { test, expect } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('on a touch screen one tap outside saves the row and still does what it tapped', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Tippen');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Gulasch');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Gulasch angelegt.').first()).toBeVisible();
  const gericht = page.locator('li', { has: page.getByText('Gulasch', { exact: true }) }).first();
  const zutat = gericht.getByLabel('Neue Zutat für Gulasch');
  for (const [name, menge] of [
    ['Hackfl', '500'],
    ['Zwiebeln', '3'],
  ]) {
    await zutat.pressSequentially(name);
    await zutat.press('Enter');
    await gericht.getByLabel('Menge der neuen Zutat').fill(menge);
    await gericht.getByLabel('Menge der neuen Zutat').press('Enter');
    await expect(zutat).toHaveValue('');
  }
  const menge = gericht.getByLabel('Menge von Hackfleisch');

  // One tap on the page outside the row saves it
  await menge.fill('700');
  await page.getByRole('heading', { name: 'E2E Zeilen Tippen' }).tap();
  await expect(page.getByText('Hackfleisch gespeichert.').first()).toBeVisible({
    timeout: 10_000,
  });

  // One tap on a button of another row saves this one and moves that one
  await menge.fill('800');
  await gericht.getByRole('button', { name: 'Zwiebeln nach oben' }).tap();
  await expect(gericht.locator('ol > li').first()).toContainText('Zwiebeln', { timeout: 10_000 });
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByText('Gulasch', { exact: true }).click();
  await expect(menge).toHaveValue('800');
});
