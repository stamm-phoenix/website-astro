import { test, expect } from './fixtures';

import type { StaffNikolausOverview } from '../src/lib/types';

test('family characteristics are explained, removable by touch and kept after a failed save', async ({
  page,
}) => {
  const overview = (await (
    await page.request.get('/api/intern/nikolaus/bookings')
  ).json()) as StaffNikolausOverview;
  const original = overview.bookings.find((booking) => booking.familyName === 'Huber')!;
  let saves = 0;
  await page.route('**/api/intern/pflege/nikolaus-bookings/*/tags', async (route) => {
    saves++;
    if (saves === 1) return route.fulfill({ status: 500, json: {} });
    return route.fulfill({
      json: { booking: { ...original, internalTags: route.request().postDataJSON().tags } },
    });
  });
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Familie Huber', exact: true });
  const input = dialog.getByRole('combobox', { name: 'Merkmale für die Einteilung', exact: true });
  await expect(dialog.getByText(/Nicht zu Familien mit/)).toBeVisible();
  const remove = dialog.getByRole('button', { name: 'Wölflinge entfernen', exact: true });
  const size = await remove.boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(input).toBeFocused();
  await input.fill('Testmerkmal');
  await input.press('Enter');
  await dialog.getByRole('button', { name: 'Merkmale speichern', exact: true }).click();
  await expect(dialog).toContainText('Die Merkmale wurden nicht gespeichert.');
  await expect(
    dialog.getByRole('button', { name: 'Testmerkmal entfernen', exact: true })
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Merkmale speichern', exact: true }).click();
  await expect(dialog.getByText('Merkmale gespeichert.', { exact: true })).toBeVisible();
});

test('removing a family characteristic asks before the details are closed', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  const editor = page.getByRole('dialog', { name: 'Familie Huber', exact: true });
  await editor.getByRole('button', { name: /Wölflinge entfernen$/ }).click();
  await editor.getByRole('button', { name: 'Details schließen', exact: true }).click();
  const confirm = page.getByRole('dialog', {
    name: 'Merkmale von Familie Huber verwerfen?',
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: /Wölflinge entfernen$/ })).toHaveCount(0);
});

test('removing a helper preference asks before the editor discards it', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-helfende?ansicht=helfende');
  await page.getByRole('button', { name: /^Bearbeiten.*Katharina Huber/ }).click();
  const editor = page.getByRole('dialog', { name: 'Person bearbeiten', exact: true });
  await editor.getByRole('button', { name: /Wölflinge entfernen$/ }).click();
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Änderungen verwerfen?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: /Wölflinge entfernen$/ })).toHaveCount(0);
  await editor.locator('#helper-negative-tags').fill('Wölflinge');
  await editor.locator('#helper-negative-tags').press('Enter');
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(confirmation).toBeHidden();
});

test('a typed family characteristic is kept when Escape opens the discard question', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  const editor = page.getByRole('dialog', { name: 'Familie Huber', exact: true });
  await editor.locator('#booking-tags-input').fill('Neues Merkmal');
  await editor.locator('#booking-tags-input').press('Escape');
  const confirmation = page.getByRole('dialog', {
    name: 'Merkmale von Familie Huber verwerfen?',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(editor.getByRole('button', { name: /Neues Merkmal entfernen$/ })).toBeVisible();
});
