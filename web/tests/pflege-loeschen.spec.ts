import { test, expect, answerConfirm } from './fixtures';

test('deleting from an edit dialog asks in the app first', async ({ page }) => {
  await page.goto('/leitendenbereich/gruppenstunden');
  const edit = page.getByRole('button', { name: /^Bearbeiten/ }).first();
  const stufe = (await edit.textContent())?.match(/\((.+)\)/)?.[1] ?? '';
  await edit.click();
  const dialog = page.getByRole('dialog', { name: `Gruppenstunde ${stufe} bearbeiten` });
  const remove = dialog.getByRole('button', { name: 'Löschen', exact: true });

  // Cancelling keeps the entry and the edit dialog
  await remove.click();
  await answerConfirm(page, 'Löschen?', 'Abbrechen');
  await expect(dialog).toBeVisible();
  await expect(remove).toBeFocused();

  await remove.click();
  await answerConfirm(page, 'Löschen?', 'Löschen');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: stufe, exact: true })).toHaveCount(0);
});
