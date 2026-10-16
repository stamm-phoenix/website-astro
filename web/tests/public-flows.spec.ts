import { test, expect, navigate, expectNoHorizontalOverflow } from './fixtures';

test('navigation and skip link work with a keyboard at both widths', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const menu = page.getByRole('button', { name: 'Menü öffnen', exact: true });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#menu-btn')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-btn')).toHaveAttribute('aria-expanded', 'false');
  }
  await navigate(page, 'Gruppenstunden');
  await expect(page).toHaveURL(/\/gruppenstunden\/?$/);
  await expect(page.getByRole('heading', { name: /Gruppenstunden/, level: 1 })).toBeVisible();
  await expect(page.getByText('Wölflinge', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('membership embed loads on request and again after Astro navigation', async ({ page }) => {
  const campflowRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('campflow-embed')) campflowRequests.push(request.url());
  });
  await page.goto('/mitmachen');
  await expect(page.getByTitle('Mitgliedsantrag')).toHaveCount(0);
  expect(campflowRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Mitgliedsantrag hier laden' }).click();
  await expect(page.getByTitle('Mitgliedsantrag')).toHaveCount(1);
  await page.frameLocator('iframe[title^="Mitgliedsantrag"]').getByLabel('Vorname').fill('Demo');
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).navigationMarker = 'same-document';
  });
  await navigate(page, 'Kontakt');
  await expect(page).toHaveURL(/\/kontakt\/?$/);
  await navigate(page, 'Mitmachen');
  await expect(page).toHaveURL(/\/mitmachen\/?$/);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).navigationMarker)
  ).toBe('same-document');
  await expect(page.getByTitle('Mitgliedsantrag')).toHaveCount(1);
  await expect(
    page.frameLocator('iframe[title^="Mitgliedsantrag"]').getByLabel('Vorname')
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('blocked membership embed shows an error and can be retried', async ({ page }) => {
  await page.route('**/api/mock/campflow-embed', (route) => route.abort());
  await page.goto('/mitmachen');
  const loadButton = page.getByRole('button', { name: 'Mitgliedsantrag hier laden' });
  await loadButton.click();
  await expect(page.getByText('Der Mitgliedsantrag konnte nicht geladen werden.')).toBeVisible();
  await expect(loadButton).toBeEnabled();
  await expect(page.getByTitle('Mitgliedsantrag')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('campflow-embed-confirmed'))).toBeNull();
  await page.unroute('**/api/mock/campflow-embed');
  await loadButton.click();
  await expect(page.getByTitle('Mitgliedsantrag')).toHaveCount(1);
  await expect(page.getByText('Der Mitgliedsantrag konnte nicht geladen werden.')).toBeHidden();
});
