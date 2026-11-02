import { test, expect } from './fixtures';

test('reloaded notice protects unsaved edits and resets when original values return', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/intern/pflege/gruppenstunden', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items.find((item: { stufe: string }) => item.stufe === 'Wölflinge').exception = {
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      message: 'Ursprünglicher Hinweis',
      location: '',
      time: '',
    };
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/intern/pflege/gruppenstunden/*/hinweis', (route) =>
    route.fulfill({ status: 409, json: { code: 'CONFLICT', message: 'Inzwischen geändert.' } })
  );
  await page.goto('/leitendenbereich/gruppenstunden-hinweise');
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Wölflinge', exact: true }) })
    .getByRole('button', { name: 'Hinweis bearbeiten', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Hinweis für Wölflinge bearbeiten' });
  await dialog.getByRole('button', { name: 'Hinweis veröffentlichen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Aktuelle Fassung laden?', exact: true })
    .getByRole('button', { name: 'Neu laden', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true })
  ).toHaveCount(0);
  const message = dialog.getByLabel('Hinweis', { exact: true });
  await expect(message).toHaveValue('Ursprünglicher Hinweis');
  await message.fill('Geänderter Hinweis');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Änderungen verwerfen?', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(message).toHaveValue('Geänderter Hinweis');
  await message.fill('Ursprünglicher Hinweis');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(confirm).toBeHidden();
});
