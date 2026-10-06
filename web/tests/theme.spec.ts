import type { Locator } from '@playwright/test';
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

/** Contrast of rendered text or an outline against its actual containing surface. */
async function renderedContrast(
  locator: Locator,
  border: boolean | 'marker' | 'left' | 'underline' = false
) {
  return locator.evaluate((element, useBorder) => {
    const luminance = (color: string) => {
      const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const linear = channels.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const styles = getComputedStyle(element);
    let surface: Element | null = element;
    while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') {
      surface = surface.parentElement;
    }
    const foreground = luminance(
      useBorder === 'marker'
        ? (styles.boxShadow.match(/rgba?\([^)]+\)/)?.[0] ?? styles.color)
        : useBorder === 'left'
          ? styles.borderLeftColor
          : useBorder === 'underline'
            ? styles.textDecorationColor
            : useBorder
              ? styles.borderTopColor
              : styles.color
    );
    const background = luminance(getComputedStyle(surface ?? element).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  }, border);
}

test('calendar today and unlinked public bars remain readable in both themes', async ({ page }) => {
  await page.route('**/api/intern/pflege/aktionen', async (route) => {
    await route.fulfill({
      json: {
        stufen: ['Wölflinge'],
        items: [
          {
            id: 'contrast-calendar',
            etag: 'mock',
            campflowId: null,
            title: 'Kalender ohne CampFlow',
            stufen: ['Wölflinge'],
            start: '2026-10-01',
            end: '2026-10-01',
            link: '',
            description: '',
          },
        ],
      },
    });
  });
  await page.goto('/leitendenbereich/aktionen');
  await page.getByRole('button', { name: 'Monat', exact: true }).click();
  const bar = page.locator('span[title="Kalender ohne CampFlow"]');
  const today = page.locator('.calendar-today');
  await expect(bar).toBeVisible();
  await expect(today).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await renderedContrast(today)).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(bar)).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(bar, true)).toBeGreaterThanOrEqual(3);
  }
});

test('invalid rich text retains a visible error outline', async ({ page }) => {
  await page.route('**/api/intern/pflege/blog', (route) =>
    route.fulfill({
      status: 400,
      json: {
        code: 'INVALID',
        message: 'Bitte den Text prüfen.',
        fields: { content: 'Der Text ist ungültig.' },
      },
    })
  );
  await page.goto('/leitendenbereich/blog/beitrag');
  await page.getByLabel('Titel', { exact: true }).fill('Kontrastprüfung');
  await page.getByRole('button', { name: 'Als Entwurf anlegen', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  const composite = editor.locator('..');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await renderedContrast(composite, true)).toBeGreaterThanOrEqual(3);
  }
});

test('manual theme choice overrides the system and persists through navigation and reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Dunkles Theme', exact: true });
  const lily = page.locator('.brand-mark--phoenix use[clip-path]').first();
  const contour = page.locator('.brand-mark--phoenix use:not([clip-path])').first();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(lily).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await expect(contour).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(lily).toHaveCSS('fill', 'rgb(236, 223, 203)');
  await expect(contour).toHaveCSS('fill', 'rgba(0, 0, 0, 0)');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(16, 27, 38)');
  await expect(page.locator('.brand-mark--dpsg').first()).toHaveCSS(
    'filter',
    'brightness(0) invert(1)'
  );
  await navigate(page, 'Gruppenstunden');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(lily).toHaveCSS('fill', 'rgb(236, 223, 203)');
  await expect(contour).toHaveCSS('fill', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => localStorage.getItem('phoenix-theme'))).toBe('dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(248, 245, 239)');
  await expect(page.locator('.brand-mark--dpsg').first()).toHaveCSS('filter', 'none');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(lily).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await expect(contour).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await expectNoHorizontalOverflow(page);
});

test('theme switch works when local storage is blocked and survives Astro navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'phoenix-theme') throw new Error('Storage unavailable');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'phoenix-theme') throw new Error('Storage unavailable');
      return setItem.call(this, key, value);
    };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Dunkles Theme', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await navigate(page, 'Gruppenstunden');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(248, 245, 239)');
});

test('selected Nikolaus time and its marker stay readable in both themes', async ({ page }) => {
  await page.goto('/nikolaus/termin#token=mock');
  await page.getByRole('button', { name: 'Anderen Termin wählen', exact: true }).click();
  const available = page.locator('.slot input[type="radio"]:enabled').first();
  await available.check();
  const selected = page.locator('.slot-checked');
  await expect(available).toBeChecked();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await selected.hover();
    expect(await renderedContrast(selected)).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(selected, 'marker')).toBeGreaterThanOrEqual(3);
    await page.mouse.move(0, 0);
    expect(await renderedContrast(selected)).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(selected, 'marker')).toBeGreaterThanOrEqual(3);
    await available.focus();
    await page.keyboard.press('Space');
    await expect(selected).toHaveCSS('outline-style', 'solid');
  }
  await expectNoHorizontalOverflow(page);
});

test('Nikolaus selection and error indicators remain distinct in both themes', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo');
  const days = page.getByRole('group', { name: 'Tag wählen', exact: true });
  await expect(days).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await days.getByRole('button').last().click();
    const selected = days.getByRole('button', { pressed: true });
    expect(await renderedContrast(selected)).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(selected, 'underline')).toBeGreaterThanOrEqual(3);
  }
  await page.route('**/api/intern/nikolaus/bookings', (route) =>
    route.fulfill({ status: 503, json: { message: 'Test: Daten nicht verfügbar.' } })
  );
  await page.goto('/leitendenbereich/nikolaus');
  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await renderedContrast(error, 'left')).toBeGreaterThanOrEqual(3);
  }
});
