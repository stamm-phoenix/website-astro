import { test, expect } from './fixtures';

test('notice statuses change on Berlin midnight without reloading the module', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T21:59:30Z') });
  await page.route('**/api/intern/pflege/gruppenstunden', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items[0].exception = {
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      message: 'Heute',
      location: '',
      time: '',
    };
    data.items[1].exception = {
      startDate: '2026-10-02',
      endDate: '2026-10-02',
      message: 'Morgen',
      location: '',
      time: '',
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/gruppenstunden-hinweise');
  const today = page.getByRole('listitem').filter({ hasText: 'Heute' });
  const tomorrow = page.getByRole('listitem').filter({ hasText: 'Morgen' });
  await expect(today.getByText('Aktuell', { exact: true })).toBeVisible();
  await expect(tomorrow.getByText('Geplant', { exact: true })).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(today.getByText('Abgelaufen', { exact: true })).toBeVisible();
  await expect(tomorrow.getByText('Aktuell', { exact: true })).toBeVisible();
});
