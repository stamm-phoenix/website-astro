import type { Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

async function gerichtAnlegen(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill(name);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
}

test('dishes are planned, ordered, copied, moved and taken off meals', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Einplanung');
  await gerichtAnlegen(page, 'Chili');
  await gerichtAnlegen(page, 'Pudding');
  await page.getByRole('tab', { name: 'Plan' }).click();
  const dialog = page.getByRole('dialog');

  // Chili for lunch, Kim is responsible
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await expect(dialog.getByRole('heading', { name: 'Gericht für 1_2 Mittagessen' })).toBeVisible();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Chili' });
  await dialog.getByLabel('Zuständig (optional)').selectOption({ label: 'Kim Küche' });
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(page.getByText('Chili eingeplant.').first()).toBeVisible();
  const mittag = page.getByRole('list', { name: 'Gerichte bei 1_2' });
  await expect(mittag.getByText('Chili')).toBeVisible();
  await expect(mittag.getByText('Kim Küche')).toBeVisible();

  // Pudding for half of them; a factor of 0 is refused
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Pudding' });
  await dialog.getByLabel('Faktor', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(dialog.getByText(/Bitte eine Zahl größer als 0/)).toBeVisible();
  await dialog.getByLabel('Faktor', { exact: true }).fill('0,5');
  await dialog.getByLabel('Zuständig (optional)').selectOption({ label: 'Jemand anderes …' });
  await dialog.getByLabel('Name', { exact: true }).fill('Küchenteam');
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(mittag.getByText('×0,5')).toBeVisible();
  await expect(mittag.getByText('Küchenteam')).toBeVisible();

  // Dessert first
  await mittag.getByRole('button', { name: 'Pudding bei 1_2 nach oben' }).click();
  await expect(mittag.locator(':scope > li').first()).toContainText('Pudding');

  // Another window sees the plan
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await expect(anderes.getByRole('list', { name: 'Gerichte bei 1_2' })).toContainText('Pudding');

  // Copy the chili to the next day's lunch, move the pudding to the evening
  await mittag.getByRole('button', { name: 'Chili bei 1_2 kopieren' }).click();
  await dialog.getByLabel('Mahlzeit', { exact: true }).selectOption({ label: '2_2 Mittagessen' });
  await dialog.getByRole('button', { name: 'Kopieren' }).click();
  await expect(page.getByRole('list', { name: 'Gerichte bei 2_2' })).toContainText('Chili');
  await expect(page.getByRole('list', { name: 'Gerichte bei 2_2' })).toContainText('Kim Küche');
  await mittag.getByRole('button', { name: 'Pudding bei 1_2 ändern' }).click();
  await expect(dialog.getByLabel('Faktor', { exact: true })).toHaveValue('0,5');
  await dialog.getByLabel('Mahlzeit', { exact: true }).selectOption({ label: '1_4 Abendessen' });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_4' })).toContainText('Pudding');
  await expect(mittag).not.toContainText('Pudding');

  // Taking the copy off again
  await page
    .getByRole('list', { name: 'Gerichte bei 2_2' })
    .getByRole('button', { name: 'Chili aus 2_2 entfernen' })
    .click();
  await answerConfirm(page, 'Chili aus 2_2 nehmen?', 'Entfernen');
  await expect(page.getByRole('list', { name: 'Gerichte bei 2_2' })).toHaveCount(0);

  // The dish shows where it is planned
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  // Dishes created on this page are open already
  await expect(page.getByText('Eingeplant: 1_2 Mittagessen')).toBeVisible();

  // The printed plan names the dishes
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.emulateMedia({ media: 'print' });
  const abend = page.getByRole('list', { name: 'Gerichte bei 1_4' });
  await expect(abend.getByText('Pudding')).toBeVisible();
  await expect(abend.getByText('Küchenteam')).toBeVisible();
  await expect(abend.getByRole('button', { name: 'Pudding bei 1_4 ändern' })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expectNoHorizontalOverflow(page);
  await anderes.context().close();
});

test('a meal or dish deleted keeps what others planned meanwhile', async ({ page, browser }) => {
  await anlegen(page, 'E2E Einplanung Konflikt');
  await gerichtAnlegen(page, 'Suppe');
  await page.getByRole('tab', { name: 'Plan' }).click();

  // A asks to delete lunch, B plans the soup there meanwhile
  await page.getByRole('button', { name: 'Mittagessen löschen' }).first().click();
  await expect(page.getByRole('dialog', { name: '1_2 Mittagessen löschen?' })).toBeVisible();
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await anderes.getByRole('dialog').getByRole('button', { name: 'Einplanen' }).click();
  await expect(anderes.getByText('Suppe eingeplant.').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toBeAttached({
    timeout: 15_000,
  });
  await answerConfirm(page, '1_2 Mittagessen löschen?', 'Mahlzeit löschen');
  await expect(page.getByText(/Jemand anderes hat das gerade geändert/).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toContainText('Suppe');

  // A changes the planned soup in the dialog while B changes it: the dialog says so itself
  const suppe = page.getByRole('list', { name: 'Gerichte bei 1_2' });
  await suppe.getByRole('button', { name: 'Suppe bei 1_2 ändern' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Faktor', { exact: true }).fill('0,1234');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByText(/Bitte eine Zahl größer als 0/)).toBeVisible();
  const andereListe = anderes.getByRole('list', { name: 'Gerichte bei 1_2' });
  await andereListe.getByRole('button', { name: 'Suppe bei 1_2 ändern' }).click();
  await anderes.getByRole('dialog').getByLabel('Faktor', { exact: true }).fill('2');
  await anderes.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(andereListe.getByText('×2')).toBeVisible();
  await expect(suppe.getByText('×2')).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel('Faktor', { exact: true }).fill('0,5');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/Jemand anderes hat das gerade geändert/);
  await expect(suppe.getByText('×2')).toBeVisible();
  // Saving again takes the input over the saved state
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(suppe.getByText('×0,5')).toBeVisible();

  // Deleting the dish takes it off its meal
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByRole('button', { name: 'Gericht löschen' }).click();
  await answerConfirm(page, '„Suppe“ löschen?', 'Gericht löschen');
  await expect(page.getByText('Suppe gelöscht.').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toHaveCount(0);
  await anderes.context().close();
});

test('the read-only link shows the planned dishes without changing them', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Einplanung lesen');
  await gerichtAnlegen(page, 'Brotzeit');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_1' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Zuständig (optional)').selectOption({ label: 'Kim Küche' });
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(page.getByText('Brotzeit eingeplant.').first()).toBeVisible();
  // A long name without spaces wraps instead of widening the plan
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await dialog.getByLabel('Zuständig (optional)').selectOption({ label: 'Jemand anderes …' });
  await dialog.getByLabel('Name', { exact: true }).fill('K'.repeat(100));
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).nth(1).click();
  // The personal link and then the new read-only link
  await expect(
    page.locator('.copy-code .font-mono').filter({ hasText: '/essensplanung/planung#t=' })
  ).toHaveCount(2);
  const lesen = await page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/planung#t=' })
    .last()
    .textContent();
  const leser = await (await browser.newContext()).newPage();
  await leser.goto(lesen!.trim());
  const fruehstueck = leser.getByRole('list', { name: 'Gerichte bei 1_1' });
  await expect(fruehstueck).toContainText('Brotzeit');
  await expect(fruehstueck).toContainText('Kim Küche');
  await expect(leser.getByRole('button', { name: /Gericht einplanen/ })).toHaveCount(0);
  await expect(fruehstueck.getByRole('button')).toHaveCount(0);
  await expectNoHorizontalOverflow(leser);
  await leser.context().close();
});
