import { test, expect, expectNoHorizontalOverflow } from './fixtures';

// The public menu on a phone: opening, keyboard use and reversals must share one state.
test('the phone menu reverses without a jump and closes access immediately', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Menü öffnen', exact: true });
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('#mobile-menu');
  await expect(panel).not.toHaveAttribute('inert', '');
  await expectNoHorizontalOverflow(page);
  // Use DOM activation to reverse during motion; click auto-wait would hide that race.
  const reversal = await page.evaluate(async (selector) => {
    const panel = document.querySelector<HTMLElement>(selector)!;
    const button = document.querySelector<HTMLButtonElement>(`[aria-controls="${panel.id}"]`)!;
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // First reach the open state, then reverse a running close.
    await new Promise((resolve) => setTimeout(resolve, 180));
    button.click();
    await frame();
    await frame();
    const closedIsInert = panel.inert;
    const before = Number(getComputedStyle(panel).opacity);
    button.click();
    await Promise.resolve();
    const after = Number(getComputedStyle(panel).opacity);
    return { closedIsInert, before, after, openIsInert: panel.inert };
  }, '#mobile-menu');
  expect(reversal.closedIsInert).toBe(true);
  expect(reversal.openIsInert).toBe(false);
  expect(reversal.before).toBeGreaterThan(0);
  expect(Math.abs(reversal.after - reversal.before)).toBeLessThan(0.05);
  await expect(panel).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('inert', '');
  await expect(button).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await panel.evaluate((node) => node.contains(document.activeElement))).toBe(false);

  // Preference changes during a visit take effect without a reload.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCSS('transform', 'none');
  await expect(panel).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCSS('visibility', 'hidden');
  await expect(button).toBeFocused();
});

test('dialog focus and unsaved input survive fast close/reopen and a failed save', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/gruppenstunden');
  const opener = page.getByRole('button', { name: /^Bearbeiten/ }).first();
  await expect(opener).toBeVisible();
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < 3; i++) {
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCSS('transform', 'none');
  await dialog.getByLabel('Ort', { exact: true }).fill('TEST – Eingabe erhalten');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/pflege/gruppenstunden/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await pending;
    await route.fulfill({
      status: 500,
      json: { error: 'Error', message: 'Speichern fehlgeschlagen' },
    });
  });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Wird gespeichert/ })).toBeDisabled();
  await expect(page.locator('[data-toast]').filter({ hasText: 'gespeichert' })).toHaveCount(0);
  release();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Ort', { exact: true })).toHaveValue('TEST – Eingabe erhalten');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('motion-save-error-390.png') });
});

test('the menu keeps its box while closed, so toggling it only changes paint', async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Menü öffnen', exact: true });
  await expect(button).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  const frames = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('#menu-btn')!;
    const frames: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 36; i++) {
      if (i % 6 === 0) button.click();
      const time = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      frames.push(time - last);
      last = time;
    }
    return frames.slice(1);
  });
  const after = await cdp.send('Performance.getMetrics');
  const changes = Object.fromEntries(
    after.metrics
      .filter((metric) =>
        ['LayoutCount', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'].includes(
          metric.name
        )
      )
      .map((metric) => [
        metric.name,
        metric.value - before.metrics.find((previous) => previous.name === metric.name)!.value,
      ])
  );
  const result = {
    viewport: page.viewportSize(),
    toggles: 6,
    ...changes,
    maxFrameMs: Math.max(...frames),
    meanFrameMs: frames.reduce((sum, frame) => sum + frame, 0) / frames.length,
  };
  await testInfo.attach('rendering-costs', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  await cdp.detach();
  // Opacity, transform and visibility only: the closed panel keeps its box, so opening it moves
  // nothing on the page. Chromium's layout counter is attached above but not asserted: it also
  // counts the panel's own text when its visibility changes, and that varies between runs.
  const panel = page.locator('#mobile-menu');
  await expect(panel).toHaveAttribute('data-open', 'false');
  const closed = await panel.evaluate((element) => ({
    display: getComputedStyle(element).display,
    height: element.getBoundingClientRect().height,
  }));
  await button.click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  expect(closed.display).not.toBe('none');
  expect(closed.height).toBe(
    await panel.evaluate((element) => element.getBoundingClientRect().height)
  );
});

test('desktop navigation opens at its trigger and Escape returns focus', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'Desktop width only');
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto('/');
  const trigger = page.locator('.site-more > summary');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('.site-more > ul');
  await expect(panel).toBeVisible();
  const anchor = (await trigger.boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(Math.abs(box.x + box.width - (anchor.x + anchor.width))).toBeLessThan(1);
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('Reduced Motion changes JavaScript scrolling while tabs and focus respond immediately', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  // Observe the real scroll request instead of depending on an arbitrary scroll duration.
  await page.evaluate(() => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      this.setAttribute(
        'data-scroll-behavior',
        typeof options === 'object' ? (options.behavior ?? '') : ''
      );
      original.call(this, options);
    };
  });
  for (const preference of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion: preference });
    const tab = page.getByRole('tab', { name: /^Teilnehmende/ });
    await page.getByRole('tab', { name: 'Übersicht', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Zur KJR-Teilnahmeliste' }).click();
    const heading = page.getByRole('heading', { name: 'Teilnahmeliste für den KJR' });
    await expect(heading).toHaveAttribute(
      'data-scroll-behavior',
      preference === 'reduce' ? 'instant' : 'smooth'
    );
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  }
});

test('a toast confirms the completed request and can be dismissed immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/gruppenstunden');
  const reload = page.getByRole('button', { name: 'Neu laden', exact: true });
  await expect(reload).toBeEnabled();
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/intern/pflege/gruppenstunden', async (route) => {
      await pending;
      await route.fallback();
    });
    await reload.click();
    await expect(page.getByRole('button', { name: 'Lädt …', exact: true })).toBeDisabled();
    await expect(page.getByText('Liste aktualisiert.', { exact: true })).toHaveCount(0);
    release();
    const toast = page.getByRole('status').filter({ hasText: 'Liste aktualisiert.' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('aria-live', 'polite');
    await toast.getByRole('button', { name: 'Hinweis schließen' }).press('Enter');
    await expect(page.getByText('Liste aktualisiert.', { exact: true })).toHaveCount(0);
    await page.unroute('**/api/intern/pflege/gruppenstunden');
  }
});
