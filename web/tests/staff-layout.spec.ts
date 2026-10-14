import { test, expect } from './fixtures';

test('the staff menu leads to every module and marks the current one', async ({ page }) => {
  await page.goto('/leitendenbereich/blog/beitrag');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  const breadcrumb = page.getByRole('navigation', { name: 'Brotkrümelnavigation' });
  await expect(breadcrumb.getByRole('link')).toHaveText(['Leitendenbereich', 'Blog']);

  // The menu reacts once its island has hydrated
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  const toggle = page.getByRole('button', { name: 'Bereiche' });
  await toggle.click();
  const menu = page.getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' });
  await expect(menu.getByRole('link', { name: 'Blog' })).toHaveAttribute('aria-current', 'true');
  await expect(menu.getByRole('link', { name: 'Steuerung' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Zur Website' })).toHaveAttribute('href', '/');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await menu.getByRole('link', { name: 'Gruppenstunden' }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/gruppenstunden/);
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: 'Bereiche' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
      .getByRole('link', { name: 'Gruppenstunden' })
  ).toHaveAttribute('aria-current', 'page');
});
