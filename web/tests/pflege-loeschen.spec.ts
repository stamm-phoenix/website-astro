import { test, expect, answerConfirm } from './fixtures';

test('deleting from an edit dialog asks in the app first', async ({ page }) => {
  // Its own entry, so the demo data other tests rely on stays in place
  const location = `TEST – bitte löschen ${test.info().project.name}`;
  const created = await page.request.post('/api/intern/pflege/gruppenstunden', {
    data: { stufe: 'Rover', weekday: 'Montag', time: '19:00 - 21:00', location },
  });
  expect(created.ok()).toBe(true);

  await page.goto('/leitendenbereich/gruppenstunden');
  const entry = page.getByRole('listitem').filter({ hasText: location });
  await entry.getByRole('button', { name: /^Bearbeiten/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Rover bearbeiten' });
  const remove = dialog.getByRole('button', { name: 'Löschen', exact: true });

  // Cancelling keeps the entry and the edit dialog
  await remove.click();
  await answerConfirm(page, 'Löschen?', 'Abbrechen');
  await expect(dialog).toBeVisible();
  await expect(remove).toBeFocused();

  await remove.click();
  await answerConfirm(page, 'Löschen?', 'Löschen');
  await expect(dialog).toBeHidden();
  await expect(entry).toHaveCount(0);
});
