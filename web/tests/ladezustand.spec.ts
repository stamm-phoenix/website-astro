import { test, expect } from './fixtures';

test('a failed load offers a retry that shows the list', async ({ page }) => {
  let fail = true;
  await page.route('**/api/intern/pflege/gruppenstunden', (route) =>
    fail && route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { message: 'Der Server ist nicht erreichbar.' } })
      : route.fallback()
  );
  await page.goto('/leitendenbereich/gruppenstunden');
  const alert = page.getByRole('alert').filter({ hasText: 'Der Server ist nicht erreichbar.' });
  await expect(alert).toBeVisible();

  fail = false;
  await alert.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(alert).toBeHidden();
  await expect(page.getByRole('button', { name: /^Bearbeiten/ }).first()).toBeVisible();
});

test('a failed reload keeps the list and says so once', async ({ page }) => {
  await page.goto('/leitendenbereich/gruppenstunden');
  await expect(page.getByRole('button', { name: /^Bearbeiten/ }).first()).toBeVisible();
  await page.route('**/api/intern/pflege/gruppenstunden', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { message: 'Der Server ist nicht erreichbar.' } })
      : route.fallback()
  );
  await page.getByRole('button', { name: 'Neu laden' }).click();

  await expect(page.getByText(/Angezeigt wird der zuletzt geladene Stand/)).toBeVisible();
  await expect(page.getByText('Der Server ist nicht erreichbar.', { exact: false })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Bearbeiten/ }).first()).toBeVisible();
});
