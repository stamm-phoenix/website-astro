import { test, expect } from './fixtures';

test('in the iPhone app an adopted calendar entry comes back with its own Stufen', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/**', (route) =>
    route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 401 })
  );
  await page.goto('/leitendenbereich/aktionen');
  const publish = page.getByRole('button', {
    name: 'Im öffentlichen Kalender veröffentlichen: Sommerlager 2026 Oberjoch',
  });
  const dialog = page.getByRole('dialog');
  const stufen = (): Promise<boolean[]> =>
    dialog
      .getByRole('group', { name: 'Stufen', exact: true })
      .getByRole('checkbox')
      .evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).checked));
  await publish.click();
  // Adopting the entry replaces the Stufen chosen before with its own
  await dialog
    .getByLabel(/Vorhandenen Kalendereintrag/)
    .selectOption({ label: 'Roverrunde: Kochabend (20.10.2026)' });
  const before = await stufen();
  await dialog
    .getByRole('button', { name: /Veröffentlichen|Speichern/ })
    .last()
    .click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await publish.click();
  await expect(dialog.getByLabel(/Vorhandenen Kalendereintrag/)).toHaveValue(/.+/);
  await expect(dialog.getByText('wieder eingesetzt. Prüf sie und speichere.')).toBeVisible();
  await expect.poll(stufen).toEqual(before);
});
