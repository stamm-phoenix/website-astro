import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('the plan shows as a calendar with the dishes as cards', async ({ page }) => {
  await anlegen(page, 'E2E Kalender');
  const dialog = page.getByRole('dialog');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Nudeln');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Nudeln angelegt.').first()).toBeVisible();

  // The days next to each other, the meals below each other
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Kalender' }).click();
  await expect(page.getByRole('button', { name: 'Kalender' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const kalender = page.getByRole('table', { name: 'Plan als Kalender' });
  await expect(kalender.getByRole('columnheader')).toHaveCount(2);
  await expect(page.locator('[data-kalender="2_5"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // A dish planned from the calendar shows there as a card with its ID
  await kalender.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Nudeln' });
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(dialog).toBeHidden();
  const karte = kalender.getByRole('button', { name: '1_2_1 Nudeln ändern' });
  await expect(karte).toContainText('Portionen');
  await karte.click();
  await expect(page.getByRole('dialog', { name: 'Nudeln ändern' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The choice stays after a reload; the list is one tap away
  await page.reload();
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(page.getByRole('table', { name: 'Plan als Kalender' })).toBeVisible();
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(page.getByRole('table', { name: 'Plan als Kalender' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toContainText('Nudeln');
});
