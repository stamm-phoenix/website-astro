import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' });
});

test('a failed load offers a retry that shows the list', async ({ page }) => {
  let fail = true;
  await page.route('**/api/intern/pflege/gruppenstunden', (route) =>
    fail && route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: 'Error', message: 'Internal Server Error' } })
      : route.fallback()
  );
  await page.goto('/leitendenbereich/gruppenstunden');
  // A crash shows what failed and whom to ask, not the server's technical text
  const alert = page
    .getByRole('alert')
    .filter({ hasText: 'Die Daten konnten nicht geladen werden.' });
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText('Internal Server Error');
  await expect(alert.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('admin-help-390.png') });

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
      ? route.fulfill({ status: 500, json: { error: 'Error', message: 'Internal Server Error' } })
      : route.fallback()
  );
  await page.getByRole('button', { name: 'Neu laden' }).click();

  await expect(page.getByText(/Angezeigt wird der zuletzt geladene Stand/)).toBeVisible();
  await expect(
    page.getByText('Die Daten konnten nicht geladen werden.', { exact: false })
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Bearbeiten/ }).first()).toBeVisible();
});
