import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('participants and groups show as a matrix of the diets, remembered and usable on a phone', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Teilnehmende Matrix');
  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  const dialog = page.getByRole('dialog');

  await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
  await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: 'Wö' });
  await dialog.getByLabel('Anzahl').fill('10');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('10 Wö gespeichert.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
  await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: 'Pfadi' });
  await dialog.getByLabel('Anzahl').fill('4');
  await dialog.getByLabel('Ernährung').selectOption('vegan');
  await dialog.getByLabel('Gluten').check();
  await dialog.getByLabel('Hinweis').fill('kommt später');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();

  // The participants as a matrix: the persons in the column of their diet, sums at the bottom
  const darstellung = page.getByRole('group', { name: 'Darstellung der Teilnehmenden' });
  await darstellung.getByRole('button', { name: 'Matrix' }).click();
  await expect(darstellung.getByRole('button', { name: 'Matrix' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const matrix = page.getByRole('table', { name: 'Teilnehmende als Matrix' });
  await expect(page.getByRole('list', { name: 'Teilnehmende Wö' })).toHaveCount(0);
  const pfadi = matrix.getByRole('row').filter({ hasText: 'Pfadi' });
  await expect(pfadi.locator('[data-anzahl="vegan"]')).toHaveText('4');
  await expect(pfadi).toContainText('Gluten');
  await expect(pfadi).toContainText('kommt später');
  await expect(matrix.getByRole('row').filter({ hasText: 'Wö' })).toContainText('ganze Zeit');
  await expect(matrix.locator('[data-summe="alles"]')).toHaveText('10');
  await expect(matrix.locator('[data-summe="vegan"]')).toHaveText('4');

  // The buttons work in the matrix as in the list
  await matrix.getByRole('button', { name: '4 Pfadi vegan ändern' }).click();
  await dialog.getByLabel('Anzahl').fill('5');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(matrix.locator('[data-summe="vegan"]')).toHaveText('5');

  // The groups as a matrix: factor, persons and persons by diet
  await page
    .getByRole('group', { name: 'Darstellung der Gruppen' })
    .getByRole('button', { name: 'Matrix' })
    .click();
  const gruppen = page.getByRole('table', { name: 'Gruppen als Matrix' });
  await expect(gruppen.locator('[data-gruppe="Pfadi"] [data-zahl]')).toHaveText(['5', '', '', '5']);
  await expect(gruppen.getByRole('row').filter({ hasText: 'Insgesamt' })).toContainText('15');
  await expect(gruppen.getByRole('button', { name: 'Gruppe Wö löschen' })).toHaveCount(0);
  await gruppen.getByRole('button', { name: 'Gruppe Rover löschen' }).click();
  await answerConfirm(page, 'Gruppe Rover löschen?', 'Löschen');
  await expect(gruppen.locator('[data-gruppe="Rover"]')).toHaveCount(0);

  // The choice stays after a reload; on a phone the matrices scroll sideways with a hint
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  await expect(matrix).toBeVisible();
  await expect(gruppen).toBeVisible();
  await expect(
    page.getByText('Weitere Spalten siehst du, wenn du seitlich wischst oder scrollst.').first()
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Back to the list
  await darstellung.getByRole('button', { name: 'Liste' }).click();
  await expect(page.getByRole('list', { name: 'Teilnehmende Pfadi' })).toContainText('vegan');
  await expect(matrix).toHaveCount(0);
});
