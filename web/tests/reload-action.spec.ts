import { test, expect } from './fixtures';
test('manual refresh is a small action next to the time of the loaded data', async ({ page }) => {
  await page.goto('/leitendenbereich/gruppenstunden');
  const reload = page.getByRole('button', { name: 'Neu laden', exact: true });
  await expect(reload).toBeEnabled();
  await expect(reload).toHaveCSS('border-bottom-width', '0px');
  await expect(reload.locator('..')).toContainText(/Stand: \d{2}:\d{2} Uhr/);
  const request = page.waitForRequest((request) =>
    request.url().includes('/intern/pflege/gruppenstunden')
  );
  await reload.click();
  await request;
  await expect(page.getByText('Liste aktualisiert.', { exact: true })).toBeVisible();
});
