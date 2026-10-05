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
        .toBe(colorScheme === 'dark' ? 'rgb(20, 32, 44)' : 'rgb(248, 245, 239)');
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
    'rgb(20, 32, 44)'
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
      .toBe(colorScheme === 'dark' ? 'rgb(255, 171, 183)' : 'rgb(129, 10, 26)');
  }
  const button = page.getByRole('button', { name: 'Abbrechen', exact: true });
  await button.hover();
  const resting = await button.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.down();
  expect(await button.evaluate((el) => getComputedStyle(el).transform)).not.toBe(resting);
  await page.mouse.up();
});
