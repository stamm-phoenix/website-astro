import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('the plan shows as a grid over the whole width, dishes are typed into a meal', async ({
  page,
}) => {
  await anlegen(page, 'E2E Kalender');
  await page.getByRole('button', { name: 'Kalender' }).click();
  await expect(page.getByRole('button', { name: 'Kalender' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const kalender = page.getByRole('grid', { name: 'Plan als Kalender' });
  // The days as columns, the meals as rows with their names on the left
  await expect(kalender.getByRole('columnheader')).toHaveCount(3);
  await expect(kalender.getByRole('rowheader', { name: 'Mittagessen' })).toBeVisible();
  await expect(page.locator('[data-kalender="2_5"]')).toBeVisible();
  // Two days share the width next to the list of dishes
  const breite = (await kalender.getByRole('columnheader').nth(1).boundingBox())?.width ?? 0;
  expect(breite).toBeGreaterThan(300);
  await expectNoHorizontalOverflow(page);

  // Arrow keys move between the cells; typing starts a dish, Enter creates and plans it
  const zelle = page.locator('[data-kalender="1_1"]');
  await zelle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-kalender="1_2"]')).toBeFocused();
  await page.keyboard.type('Nudeln');
  await expect(page.getByLabel('Gericht bei 1_2 Mittagessen')).toHaveValue('Nudeln');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nudeln angelegt und bei 1_2 eingeplant.').first()).toBeVisible();
  const karte = page.locator('[data-kalender="1_2"] [data-karte]');
  await expect(karte).toContainText('1_2_1');
  await expect(karte).toContainText('Portionen');
  await expect(karte).toContainText('noch ohne Zutaten');
  // The same name again plans the existing dish, with who is responsible
  await page.getByLabel('Gericht bei 1_2 Mittagessen').fill('nudeln');
  await page.getByLabel('Zuständig für das Gericht bei 1_2').fill('Kim Küche');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nudeln bei 1_2 eingeplant.').first()).toBeVisible();
  await expect(karte).toHaveCount(2);
  await expect(karte.nth(1)).toContainText('Kim Küche');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-kalender="1_2"]')).toBeFocused();

  // Alt+arrow moves a dish to the same meal of the next day
  await kalender.getByRole('button', { name: '1_2_2 Nudeln öffnen' }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByText('Nudeln nach 2_2 verschoben.').first()).toBeVisible();
  await expect(page.locator('[data-kalender="2_2"] [data-karte]')).toHaveCount(1);

  // Dragging: a planned dish to another meal, and a dish from the list of all dishes
  await page
    .locator('[data-kalender="2_2"] [data-karte]')
    .dragTo(page.locator('[data-kalender="2_4"]'));
  await expect(page.locator('[data-kalender="2_4"] [data-karte]')).toHaveCount(1);
  await expect(page.locator('[data-kalender="2_2"] [data-karte]')).toHaveCount(0);
  await page
    .getByRole('list', { name: 'Alle Gerichte' })
    .getByText('Nudeln')
    .dragTo(page.locator('[data-kalender="1_1"]'));
  await expect(page.locator('[data-kalender="1_1"] [data-karte]')).toHaveCount(1);

  // The checkbox ticks off „gekocht“ in one click
  await kalender.getByRole('checkbox', { name: '1_1_1 Nudeln gekocht' }).check();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  await expect(page.locator('[data-kalender="1_1"] [data-karte]')).toContainText('gekocht');

  // The name opens the dish in the area of the dishes
  await kalender.getByRole('button', { name: '1_1_1 Nudeln öffnen' }).click();
  await expect(page.getByRole('tab', { name: 'Gerichte' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(
    page.getByRole('tabpanel', { name: 'Gerichte' }).getByLabel('Name', { exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole('tabpanel', { name: 'Gerichte' }).getByLabel('Name', { exact: true })
  ).toHaveValue('Nudeln');

  // The choice stays after a reload; the list is one tap away
  await page.reload();
  await expect(page.getByRole('grid', { name: 'Plan als Kalender' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(page.getByRole('grid', { name: 'Plan als Kalender' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toContainText('Nudeln');
});
