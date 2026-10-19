import type { CDPSession, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Touch gestures on a phone: pulling an action sheet down and swiping a popup away.
test.skip(({ isMobile }) => !isMobile, 'Touch gestures exist only on phones');

interface Point {
  x: number;
  y: number;
}

/**
 * A finger moving from `from` to `to` in small steps through the browser's own touch input,
 * so hit testing, scrolling and the click after a tap behave as on a phone. It rests before
 * letting go, so the release is not a flick.
 */
async function drag(page: Page, cdp: CDPSession, from: Point, to: Point): Promise<void> {
  const steps = 12;
  const touch = (point: Point) => [{ x: point.x, y: point.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(from) });
  for (let step = 1; step <= steps; step++) {
    const point = {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(point) });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('an action sheet closes when pulled down and settles back after a short pull', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/aufgaben');
  const cdp = await page.context().newCDPSession(page);
  const opener = page
    .locator('main li[data-focus-item]')
    .first()
    .getByRole('button', { name: /^Weitere Aktionen:/ });
  const sheet = page.getByRole('dialog', { name: 'Aufgabenaktionen', exact: true });
  const heading = sheet.getByRole('heading', { name: 'Aufgabenaktionen' });

  await opener.click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('transform', 'none');
  const start = (await heading.boundingBox())!;
  const height = (await sheet.boundingBox())!.height;
  const from = { x: start.x + 20, y: start.y + start.height / 2 };

  // A short pull follows the finger, then settles back and keeps the sheet open
  await drag(page, cdp, from, { x: from.x, y: from.y + 40 });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('transform', 'none');
  expect((await heading.boundingBox())!.y).toBeCloseTo(start.y, 0);

  // Past a third of its height it closes like the close button, with focus back on the opener
  await drag(page, cdp, from, { x: from.x, y: from.y + height / 2 + 20 });
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();

  // It opens again at its place, not where the finger left it
  await opener.click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('transform', 'none');
  await expect.poll(async () => (await heading.boundingBox())!.y).toBeCloseTo(start.y, 0);
});

test('a popup disappears when swiped sideways and stays after a short swipe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/gruppenstunden');
  const cdp = await page.context().newCDPSession(page);
  const reload = page.getByRole('button', { name: 'Neu laden', exact: true });
  await expect(reload).toBeEnabled();
  await reload.click();
  const message = page.locator('[data-toast] .toast-message', { hasText: 'Liste aktualisiert.' });
  await expect(message).toBeVisible();
  const box = (await message.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await drag(page, cdp, from, { x: from.x + 40, y: from.y });
  await expect(message).toBeVisible();
  await expect(message).toHaveCSS('transform', 'none');
  await expect(message).toHaveCSS('opacity', '1');

  await drag(page, cdp, from, { x: from.x - box.width * 0.6, y: from.y });
  await expect(message).toHaveCount(0);
  // The live region stays for the next message
  await expect(page.locator('[data-toast][role="status"]').first()).toBeAttached();
});
