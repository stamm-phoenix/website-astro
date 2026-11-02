import { test, expect } from './fixtures';
import { chromium } from '@playwright/test';

for (const scenario of [
  { fontSize: 12, before: 900, after: 1024, sidebar: true },
  { fontSize: 20, before: 1200, after: 1400, sidebar: false },
]) {
  test(`the menu follows the real sidebar breakpoint with a ${scenario.fontSize}px default font`, async ({
    browserName,
    baseURL,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name !== 'mobile',
      'Check browser font preferences once on Chromium'
    );
    const browser = await chromium.launch({
      args: [`--blink-settings=defaultFontSize=${scenario.fontSize}`],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    try {
      const context = await browser.newContext({
        viewport: { width: scenario.before, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(`${baseURL}/leitendenbereich`);
      await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute(
        'ssr'
      );
      await page.getByRole('button', { name: 'Menü', exact: true }).click();
      const menu = page.getByRole('dialog', { name: 'Alle Bereiche' });
      await expect(menu).toBeVisible();
      await page.setViewportSize({ width: scenario.after, height: 900 });
      expect(await page.evaluate(() => window.matchMedia('(min-width: 80rem)').matches)).toBe(
        scenario.sidebar
      );
      if (scenario.sidebar) {
        await expect(menu).toBeHidden();
        await expect(page.locator('header').first()).not.toHaveAttribute('inert', '');
        await expect(
          page.getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
        ).toBeVisible();
      } else {
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('header').first()).not.toHaveAttribute('inert', '');
      }
    } finally {
      await browser.close();
    }
  });
}

test('a missing group selection is one correction, separately from a missing title', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/aktionen');
  await page.getByRole('button', { name: 'Aktion anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Aktion anlegen' });
  await dialog.getByLabel('Titel', { exact: true }).fill('UX-Test ohne Stufenauswahl');
  await dialog.getByLabel('Beginn', { exact: true }).fill('2026-12-01');
  await dialog.getByRole('button', { name: 'Aktion anlegen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Bitte prüfe das markierte Feld.');
  const groups = dialog.getByRole('group', { name: 'Stufen', exact: true });
  await expect(groups.getByRole('checkbox').first()).toBeFocused();
  await dialog.getByLabel('Titel', { exact: true }).clear();
  await dialog.getByRole('button', { name: 'Aktion anlegen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Bitte prüfe die 2 markierten Felder.');
  await expect(dialog.getByLabel('Titel', { exact: true })).toBeFocused();
});
