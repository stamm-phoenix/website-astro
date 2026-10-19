import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { CDPSession, Locator, Page } from '@playwright/test';
import type { Aktion } from '../src/lib/types';

// A sideways swipe on the month grid of the public calendar changes the month like the arrow
// buttons. Real touches go through the browser's own input pipeline (CDP), so `touch-action`
// and non-passive listeners are exercised like on a phone. The clock of the fixtures stands at
// 1 October 2026, so the grid opens on October.

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch gestures on phones only');
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Gesture {
  /** Horizontal distance in pixels, negative to the left. */
  dx: number;
  /** Vertical distance in pixels, negative upwards. */
  dy: number;
  /** Number of moves the distance is split into. */
  steps: number;
  /** Pause between moves in milliseconds. */
  interval: number;
  /** Rest before letting go, so the release has no speed. */
  rest: number;
}

async function drag(
  page: Page,
  start: { x: number; y: number },
  gesture: Gesture,
  hold?: () => Promise<void>
): Promise<void> {
  const client: CDPSession = await page.context().newCDPSession(page);
  const point = (i: number): { x: number; y: number } => ({
    x: start.x + (gesture.dx * i) / gesture.steps,
    y: start.y + (gesture.dy * i) / gesture.steps,
  });
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number }[]
  ): Promise<unknown> => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', [point(0)]);
  for (let i = 1; i < gesture.steps; i++) {
    await sleep(gesture.interval);
    await send('touchMove', [point(i)]);
  }
  await sleep(gesture.interval);
  if (gesture.rest || hold) {
    await send('touchMove', [point(gesture.steps)]);
    await sleep(gesture.rest);
    if (hold) await hold();
    await send('touchEnd', []);
  } else {
    // A flick lets go right after its last move, even when the machine answers slowly
    await Promise.all([send('touchMove', [point(gesture.steps)]), send('touchEnd', [])]);
  }
  await client.detach();
}

/** A sideways gesture across the middle of `area`, starting on the side it moves away from. */
async function swipe(
  page: Page,
  area: Locator,
  gesture: Omit<Gesture, 'dy'>,
  hold?: () => Promise<void>
): Promise<void> {
  const box = await area.boundingBox();
  if (!box) throw new Error('Swipe area is not visible');
  const x = box.x + box.width / 2 + (gesture.dx < 0 ? 80 : -80);
  await drag(page, { x, y: box.y + box.height / 2 }, { ...gesture, dy: 0 }, hold);
}

/** Past a quarter of the width, then held still before letting go. */
const slowLongDrag = { dx: -180, steps: 12, interval: 25, rest: 200 };
/** Short but fast: well below a quarter of the width. */
const fastFlick = { dx: -70, steps: 1, interval: 8, rest: 0 };
/** Short and slow: neither far nor fast enough. */
const slowShortDrag = { dx: -50, steps: 12, interval: 30, rest: 200 };

async function openMonth(page: Page): Promise<Locator> {
  const response = await page.request.get('/api/aktionen');
  const actions = (await response.json()) as Aktion[];
  await page.route('**/api/aktionen', (route) =>
    route.fulfill({
      json: [
        {
          ...actions[0],
          id: 'swipe-test',
          title: 'Wischtest-Aktion',
          start: '2026-10-14',
          end: '2026-10-14',
          description: '<p>Treffpunkt am Pfadfinderheim.</p>',
        },
      ],
    })
  );
  await page.goto('/aktionen?ansicht=monat');
  await expect(page.getByRole('heading', { name: 'Oktober 2026', exact: true })).toBeVisible();
  // The data from the browser has replaced the baked one
  await expect(page.getByRole('heading', { name: 'Wischtest-Aktion' })).toBeVisible();
  const grid = page.locator('.month-swipe');
  await grid.scrollIntoViewIfNeeded();
  return grid;
}

const monthHeading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 2, name, exact: true });

test('swiping left shows the next month, swiping right the previous one', async ({ page }) => {
  const grid = await openMonth(page);
  const surface = grid.locator('.surface');

  // The grid follows the finger before the release decides
  await swipe(page, grid, slowLongDrag, async () => {
    const shift = await surface.evaluate((node) => parseFloat(getComputedStyle(node).translate));
    expect(shift).toBeLessThan(-150);
    await expect(monthHeading(page, 'Oktober 2026')).toBeVisible();
  });
  // The new month appears in place, without sliding in from the old position
  expect(await surface.evaluate((node) => getComputedStyle(node).translate)).toBe('none');
  await expect(monthHeading(page, 'November 2026')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alle Aktionen im November 2026' })).toBeVisible();
  await expect(page).toHaveURL(/monat=2026-11/);

  await swipe(page, grid, fastFlick);
  await expect(monthHeading(page, 'Dezember 2026')).toBeVisible();

  await swipe(page, grid, { ...slowLongDrag, dx: 180 });
  await expect(monthHeading(page, 'November 2026')).toBeVisible();
  await swipe(page, grid, { ...fastFlick, dx: 70 });
  await expect(monthHeading(page, 'Oktober 2026')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a short slow drag keeps the month and returns the grid to its place', async ({ page }) => {
  const grid = await openMonth(page);
  await swipe(page, grid, slowShortDrag);
  await expect(monthHeading(page, 'Oktober 2026')).toBeVisible();
  await expect(grid.locator('.surface')).toHaveCSS('translate', 'none');
  // The day the finger started on was not chosen by the swipe
  await expect(grid.locator('button[aria-pressed="true"]')).toHaveCount(0);
});

test('a vertical drag on the grid scrolls the page and keeps the month', async ({ page }) => {
  const grid = await openMonth(page);
  const box = await grid.boundingBox();
  if (!box) throw new Error('Grid is not visible');
  const before = await page.evaluate(() => window.scrollY);
  await drag(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height - 20 },
    { dx: 12, dy: -200, steps: 10, interval: 20, rest: 0 }
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 50);
  await expect(monthHeading(page, 'Oktober 2026')).toBeVisible();
  await expect(grid.locator('.surface')).toHaveCSS('translate', 'none');
});

test('after a swipe, a tap on a day and on its Aktion still works', async ({ page }) => {
  const grid = await openMonth(page);
  await swipe(page, grid, fastFlick);
  await expect(monthHeading(page, 'November 2026')).toBeVisible();
  // The day under the finger was not chosen by the swipe
  await expect(grid.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await swipe(page, grid, { ...fastFlick, dx: 70 });
  await expect(monthHeading(page, 'Oktober 2026')).toBeVisible();

  const day = grid.getByRole('button', { name: /^Mittwoch, 14\. Oktober 2026/ });
  await day.tap();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'Aktionen am Mittwoch, 14. Oktober 2026' })
  ).toBeVisible();
  const card = page.getByRole('button', { name: /Wischtest-Aktion/ });
  await card.tap();
  await expect(card).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Treffpunkt am Pfadfinderheim.')).toBeVisible();
});
