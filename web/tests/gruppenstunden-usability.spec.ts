import { test, expect } from './fixtures';

test('changing a meeting time keeps a consistent format and groups the edit actions', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/gruppenstunden');
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Wölflinge', exact: true }) });
  const actions = card.locator('[data-gruppenstunden-actions]');
  await expect(actions.getByRole('button', { name: /Bearbeiten/ })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'Team bearbeiten', exact: true })).toBeVisible();
  await actions.getByRole('button', { name: /Bearbeiten/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Wölflinge bearbeiten' });
  await expect(dialog.getByRole('button', { name: 'Löschen', exact: true })).toBeHidden();
  await dialog.getByLabel('Beginn', { exact: true }).fill('16:30');
  await dialog.getByLabel('Ende', { exact: true }).fill('18:00');
  const save = page.waitForRequest(
    (r) => r.method() === 'PATCH' && r.url().includes('/pflege/gruppenstunden/')
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await save).postDataJSON().time).toBe('16:30 – 18:00 Uhr');
  await expect(card.getByText(/16:30 – 18:00 Uhr/)).toBeVisible();
});

test('removing a meeting is available through further actions and still needs confirmation', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/gruppenstunden');
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Wölflinge bearbeiten' });
  await expect(dialog.getByRole('button', { name: 'Löschen', exact: true })).toBeHidden();
  await dialog.locator('summary', { hasText: 'Weitere Aktionen' }).click();
  await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
  const confirm = page.getByRole('dialog', {
    name: 'Gruppenstunde Wölflinge löschen?',
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toBeVisible();
});
