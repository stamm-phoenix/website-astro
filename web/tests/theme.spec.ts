import { test, expect, navigate, expectNoHorizontalOverflow } from './fixtures';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`Leitfaden follows ${colorScheme} preference across public, member and staff views`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    for (const path of [
      '/',
      '/aktionen',
      '/mitmachen',
      '/leitendenbereich',
      '/leitendenbereich/belege',
      '/leitendenbereich/abrechnung',
      '/mitgliederbereich/sammelbestellungen?token=mock',
    ]) {
      await page.goto(path);
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
        .toBe(colorScheme);
      await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
        .toBe(colorScheme === 'dark' ? 'rgb(16, 27, 38)' : 'rgb(248, 245, 239)');
      await expectNoHorizontalOverflow(page);
    }
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).themeNavigation = true;
    });
    await navigate(page, 'Gruppenstunden');
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).themeNavigation)
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe(colorScheme);
    await page.emulateMedia({ colorScheme: colorScheme === 'dark' ? 'light' : 'dark' });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe(colorScheme === 'dark' ? 'light' : 'dark');
  });
}

test('dark theme and staff disclosure navigation work without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  await page.goto(`${baseURL}/leitendenbereich`);
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(16, 27, 38)'
  );
  const group = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Website pflegen' }) });
  await expect(group).not.toHaveAttribute('open', '');
  await group.locator('summary').click();
  await expect(group.getByRole('link', { name: /Downloads/ })).toBeVisible();
  await context.close();
});

test('invalid inputs retain their error border and enabled buttons show a pressed state', async ({
  page,
}) => {
  await page.goto('/nikolaus/termin#token=mock');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const field = page.getByLabel('Familienname');
  await field.fill('   ');
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect
      .poll(() => field.evaluate((el) => getComputedStyle(el).borderBottomColor))
      .toBe(colorScheme === 'dark' ? 'rgb(255, 154, 166)' : 'rgb(129, 10, 26)');
  }
  const button = page.getByRole('button', { name: 'Abbrechen', exact: true });
  await button.hover();
  const resting = await button.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.down();
  expect(await button.evaluate((el) => getComputedStyle(el).transform)).not.toBe(resting);
  await page.mouse.up();
});

test('news dialog close control stays readable in both themes and closes on touch', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.post-link').first().scrollIntoViewIfNeeded();
  await expect(page.locator('astro-island[component-url*="NewsFeed"]')).not.toHaveAttribute('ssr');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.locator('.post-link').first().click();
    const dialog = page.getByRole('dialog');
    const close = dialog.getByRole('button', { name: 'Schließen', exact: true });
    const contrast = await close.evaluate((el) => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const linear = channels.map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const styles = getComputedStyle(el);
      const foreground = luminance(styles.color);
      const background = luminance(styles.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(3);
    await close.click();
    await expect(dialog).not.toBeVisible();
  }
});

test('primary actions keep readable text across public and accounting views', async ({ page }) => {
  test.setTimeout(60_000);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const path of ['/', '/leitendenbereich/abrechnung', '/nikolaus/termin#token=mock']) {
      await page.goto(path);
      if (path.startsWith('/nikolaus/termin')) {
        await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
      }
      const actions = page.locator(
        '.btn-primary:visible:not(:disabled), .bg-action.text-on-action:visible'
      );
      await expect(actions.first()).toBeVisible();
      const contrasts = await actions.evaluateAll((elements) => {
        const luminance = (color: string) => {
          const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const linear = channels.map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        return elements.map((element) => {
          const styles = getComputedStyle(element);
          const text = luminance(styles.color);
          const fill = luminance(styles.backgroundColor);
          return (Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05);
        });
      });
      for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  }
});
