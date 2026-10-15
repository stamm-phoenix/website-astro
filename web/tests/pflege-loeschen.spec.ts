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
  const confirm = page.getByRole('dialog', { name: 'Gruppenstunde Rover löschen?' });
  await expect(confirm).toBeVisible();
  // The question stands out from the form behind it: narrower, with a shadow and a darker
  // backdrop, and a filled confirm button that outweighs „Abbrechen“.
  const [editBox, confirmBox] = await Promise.all([dialog.boundingBox(), confirm.boundingBox()]);
  expect(confirmBox!.width).toBeLessThan(editBox!.width - 8);
  const look = await confirm.evaluate((element) => {
    const button = Array.from(element.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === 'Löschen'
    );
    return {
      shadow: getComputedStyle(element).boxShadow,
      editShadow: getComputedStyle(document.querySelector('dialog[open]')!).boxShadow,
      backdrop: getComputedStyle(element, '::backdrop').backgroundColor,
      editBackdrop: getComputedStyle(document.querySelector('dialog[open]')!, '::backdrop')
        .backgroundColor,
      fill: button ? getComputedStyle(button).backgroundColor : '',
      border: button ? getComputedStyle(button).borderTopColor : '',
    };
  });
  expect(look.shadow).not.toBe('none');
  expect(look.shadow).not.toBe(look.editShadow);
  const alpha = (color: string): number => Number(/[\d.]+(?=\)$)/.exec(color)?.[0] ?? 1);
  expect(alpha(look.backdrop)).toBeGreaterThan(alpha(look.editBackdrop));
  expect(look.fill).toBe(look.border);
  await answerConfirm(page, 'Gruppenstunde Rover löschen?', 'Abbrechen');
  await expect(dialog).toBeVisible();
  await expect(remove).toBeFocused();

  await remove.click();
  await answerConfirm(page, 'Gruppenstunde Rover löschen?', 'Löschen');
  await expect(dialog).toBeHidden();
  await expect(entry).toHaveCount(0);
});

test('deleting a person names the person in the question', async ({ page }) => {
  await page.goto('/leitendenbereich/leitende');
  const first = page.locator('main ul li button').first();
  const name = (await first.locator('span.font-semibold').textContent())!.trim();
  await first.click();
  const dialog = page.getByRole('dialog', { name: `${name} bearbeiten` });
  await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
  await answerConfirm(page, `${name} löschen?`, 'Abbrechen');
  await expect(dialog).toBeVisible();
});
