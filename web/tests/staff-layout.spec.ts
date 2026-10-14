import { test, expect } from './fixtures';

test('the staff menu leads to every module and marks the current one', async ({ page }) => {
  await page.goto('/leitendenbereich/blog/beitrag');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  const breadcrumb = page.getByRole('navigation', { name: 'Brotkrümelnavigation' });
  await expect(breadcrumb.getByRole('link')).toHaveText(['Leitendenbereich', 'Blog']);

  // The menu reacts once its island has hydrated
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  const toggle = page.getByRole('button', { name: 'Menü' });
  await toggle.click();
  const menu = page.getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' });
  await expect(menu.getByRole('link', { name: 'Blog' })).toHaveAttribute('aria-current', 'true');
  await expect(menu.getByRole('link', { name: 'Steuerung' })).toBeVisible();
  // The account links stay in view below the module list
  const panel = page.locator('#staff-nav');
  await expect(panel.getByRole('link', { name: 'Zur Website' })).toHaveAttribute('href', '/');
  await expect(panel.getByRole('link', { name: 'Abmelden' })).toBeInViewport({ ratio: 1 });

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await menu.getByRole('link', { name: 'Gruppenstunden' }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/gruppenstunden/);
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: 'Menü' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
      .getByRole('link', { name: 'Gruppenstunden' })
  ).toHaveAttribute('aria-current', 'page');
});

test('closed sections of the start page name their modules', async ({ page }) => {
  await page.goto('/leitendenbereich');
  const kasse = page.locator('summary', { hasText: 'Kasse' });
  await expect(kasse.getByRole('heading', { name: 'Kasse', level: 2 })).toBeVisible();
  await expect(kasse).toContainText('Belege, Eigenbeleg, Abrechnung');
  await kasse.click();
  await expect(kasse).toContainText('3 Bereiche');
  await expect(page.getByRole('link', { name: /^Belege/ })).toBeVisible();
});
