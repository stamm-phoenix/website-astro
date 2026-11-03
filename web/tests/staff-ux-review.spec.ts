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

test('a failed favorite can be retried inside the open mobile menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.put('/api/intern/favoriten', { data: { modules: [] } });
  let failSave = true;
  await page.route('**/api/intern/favoriten', async (route) => {
    if (route.request().method() === 'PUT' && failSave) {
      failSave = false;
      await route.fulfill({ status: 503, json: {} });
    } else {
      await route.continue();
    }
  });
  await page.goto('/leitendenbereich/belege');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Alle Bereiche' });
  await menu.getByRole('button', { name: 'Belege als Favorit', exact: true }).click();
  const notice = page
    .getByRole('status')
    .filter({ hasText: 'Deine Favoriten wurden nicht gespeichert.' });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('aria-live', 'polite');
  const retry = notice.getByRole('button', { name: 'Erneut speichern', exact: true });
  await retry.focus();
  await expect(retry).toBeFocused();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole('status').filter({ hasText: 'Favoriten gespeichert.' })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Alle Bereiche' })
      .getByRole('button', { name: 'Belege als Favorit', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('a missing receipt photo highlights its visible chooser after a pointer submission', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  await dialog.getByRole('button', { name: 'Einreichen', exact: true }).click();
  const input = dialog.locator('input[type="file"]');
  await expect(input).toBeFocused();
  const chooser = dialog.locator('label:has(input[type="file"])');
  for (const [colorScheme, color] of [
    ['light', 'rgb(0, 48, 86)'],
    ['dark', 'rgb(140, 203, 236)'],
  ] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(chooser).toBeInViewport();
    await expect(chooser).toHaveCSS('outline-style', 'solid');
    await expect(chooser).toHaveCSS('outline-width', '3px');
    await expect(chooser).toHaveCSS('outline-color', color);
    await page.screenshot({ path: testInfo.outputPath(`belegfoto-fokus-${colorScheme}.png`) });
  }
  const opened = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  expect((await opened).isMultiple()).toBe(false);
});

for (const scenario of [
  { mode: 'create', label: 'Aktion anlegen', open: 'Aktion anlegen' },
  { mode: 'edit', label: 'Speichern', open: 'Kalendereintrag bearbeiten: Leiterrunde' },
  {
    mode: 'publish',
    label: 'Veröffentlichen',
    open: 'Im öffentlichen Kalender veröffentlichen: Sommerlager 2026 Oberjoch',
  },
]) {
  test(`a failed action ${scenario.mode} names the available retry and preserves the input`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(/\/api\/intern\/pflege\/aktionen(?:\/[^?]*)?(?:\?.*)?$/, (route) =>
      ['POST', 'PATCH'].includes(route.request().method())
        ? route.fulfill({ status: 503, body: 'unavailable' })
        : route.continue()
    );
    await page.goto('/leitendenbereich/aktionen?jahr=alle');
    const detail =
      scenario.mode === 'publish'
        ? page.waitForResponse((response) =>
            response.url().endsWith('/api/intern/aktionen/evt_Sola26')
          )
        : null;
    await page.getByRole('button', { name: scenario.open, exact: true }).click();
    if (detail) await detail;
    const dialog = page.getByRole('dialog');
    if (scenario.mode === 'create') {
      await dialog.getByLabel('Titel', { exact: true }).fill('Aktion mit erhaltenen Eingaben');
      await dialog.getByLabel('Beginn', { exact: true }).fill('2026-12-02');
    }
    const group = dialog.getByRole('checkbox', { name: 'Rover', exact: true });
    await group.uncheck();
    await group.check();
    const submit = dialog.getByRole('button', { name: scenario.label, exact: true });
    await submit.click();
    const error = dialog.getByRole('alert');
    await expect(error).toContainText(`Tippe noch einmal auf „${scenario.label}“.`);
    await expect(error).toContainText('Deine Eingaben sind noch da.');
    await expect(submit).toBeEnabled();
    await expect(group).toBeChecked();
    if (scenario.mode === 'create') {
      await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue(
        'Aktion mit erhaltenen Eingaben'
      );
      await expect(dialog.getByLabel('Beginn', { exact: true })).toHaveValue('2026-12-02');
    }
  });
}
