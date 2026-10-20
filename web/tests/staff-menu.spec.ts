import { test, expect } from './fixtures';

test('„Menü“ closes the sheet „Alle Bereiche“ again', async ({ page, browserName }) => {
  if (browserName !== 'webkit') {
    // Like Safari: a click on a button focuses its nearest focusable ancestor instead
    await page.addInitScript(() =>
      document.addEventListener(
        'mousedown',
        (event) => {
          const button = event.target instanceof Element ? event.target.closest('button') : null;
          if (!button) return;
          event.preventDefault();
          button.parentElement?.closest<HTMLElement>('[tabindex]')?.focus();
        },
        true
      )
    );
  }
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/leitendenbereich');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  const menu = page
    .getByRole('navigation', { name: 'Schnellzugriff' })
    .getByRole('button', { name: 'Menü', exact: true });
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });

  // Safari focuses the surrounding <main tabindex="-1"> on this click
  await menu.click();
  await expect(sheet).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await menu.click();
  await expect(sheet).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  // The dimmed page beside the sheet (at most 576px wide, centered) closes it too
  await menu.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(20, 300);
  await expect(sheet).toBeHidden();
});

test('keyboard focus leaving the sheet „Alle Bereiche“ closes it', async ({
  page,
  browserName,
}) => {
  // WebKit on Linux skips links on Tab
  test.skip(browserName === 'webkit');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  await page
    .getByRole('navigation', { name: 'Schnellzugriff' })
    .getByRole('button', { name: 'Menü', exact: true })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  // Opening moves focus after two animation frames. Wait for it before setting up Tab,
  // otherwise that late focus can replace Abmelden while the sheet is still off-screen.
  await expect(sheet.getByRole('button', { name: 'Schließen', exact: true })).toBeFocused();
  const signOut = sheet.getByRole('link', { name: 'Abmelden' });
  await signOut.focus();
  await expect(signOut).toBeFocused();
  // Logout sits in the fixed header; the final navigation link ends the tab sequence.
  await sheet.getByRole('link').last().focus();
  await page.keyboard.press('Tab');
  await expect(sheet).toBeHidden();
});
