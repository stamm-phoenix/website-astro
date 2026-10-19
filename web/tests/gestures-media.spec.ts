import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { CDPSession, Locator, Page } from '@playwright/test';

// Swipes in the image viewers follow the finger and decide on release, by distance or speed.
// Real touches go through the browser's own input pipeline (CDP), so `touch-action` and
// non-passive listeners are exercised like on a phone.

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch gestures on phones only');
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Gesture {
  /** Horizontal distance in pixels, negative to the left. */
  distance: number;
  /** Number of moves the distance is split into. */
  steps: number;
  /** Pause between moves in milliseconds. */
  interval: number;
  /** Rest before letting go, so the release has no speed. */
  rest: number;
}

async function swipe(
  page: Page,
  area: Locator,
  gesture: Gesture,
  hold?: () => Promise<void>
): Promise<void> {
  const box = await area.boundingBox();
  if (!box) throw new Error('Swipe area is not visible');
  const client: CDPSession = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2 + (gesture.distance < 0 ? 60 : -60);
  const y = box.y + box.height / 2;
  const point = (dx: number): { x: number; y: number } => ({ x: x + dx, y });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0)] });
  for (let i = 1; i <= gesture.steps; i++) {
    await sleep(gesture.interval);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point((gesture.distance * i) / gesture.steps)],
    });
  }
  if (gesture.rest) await sleep(gesture.rest);
  if (hold) await hold();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/** Past a quarter of the width, then held still before letting go. */
const slowLongDrag: Gesture = { distance: -180, steps: 12, interval: 25, rest: 200 };
/** Short but fast: well below a quarter of the width. */
const fastFlick: Gesture = { distance: -80, steps: 2, interval: 8, rest: 0 };
/** Short and slow: neither far nor fast enough. */
const slowShortDrag: Gesture = { distance: -60, steps: 12, interval: 30, rest: 200 };

async function openFoto(page: Page, folder: string, name: string): Promise<Locator> {
  await page.goto(`/leitendenbereich/fotos#pfad=${encodeURIComponent(folder)}`);
  await page.getByRole('button', { name: `${name} groß anzeigen`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
  return dialog;
}

const SOLA = 'Aktionen/2026/Sommerlager Westernohe/Nico';

test('a long slow drag and a short flick both move to the next photo', async ({ page }) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.getByRole('group', { name: /Wische zur Seite/ });
  await expect(dialog.getByText('1 von 15', { exact: true })).toBeVisible();

  const media = area.locator('.swipe-media');
  // The photo follows the finger before the release decides
  await swipe(page, area, slowLongDrag, async () => {
    const shift = await media.evaluate((node) => parseFloat(getComputedStyle(node).translate));
    expect(shift).toBeLessThan(-150);
    await expect(dialog.getByText('1 von 15', { exact: true })).toBeVisible();
  });
  await expect(dialog.getByText('2 von 15', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'IMG_4302.jpg', exact: true })).toBeVisible();
  // The new photo appears in place, without sliding in from the old position
  await expect(media).toHaveCSS('translate', 'none');

  await swipe(page, area, fastFlick);
  await expect(dialog.getByText('3 von 15', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'IMG_4303.jpg', exact: true })).toBeVisible();

  // A swipe to the right goes back
  await swipe(page, area, { ...slowLongDrag, distance: 180 });
  await expect(dialog.getByText('2 von 15', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a short slow drag keeps the photo and returns it to its place', async ({ page }) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.getByRole('group', { name: /Wische zur Seite/ });
  await swipe(page, area, slowShortDrag);
  await expect(dialog.getByText('1 von 15', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'IMG_4301.jpg', exact: true })).toBeVisible();
  await expect(area.locator('.swipe-media')).toHaveCSS('translate', 'none');
});

test('at the last photo a swipe does not change it', async ({ page }) => {
  const dialog = await openFoto(page, 'Aktionen/2026/Herbstwanderung', 'PXL_20261014.jpg');
  const area = dialog.getByRole('group', { name: /Wische zur Seite/ });
  await expect(dialog.getByText('4 von 4', { exact: true })).toBeVisible();
  const media = area.locator('.swipe-media');
  // The photo only gives a little instead of following the finger all the way
  await swipe(page, area, slowLongDrag, async () => {
    const shift = await media.evaluate((node) => parseFloat(getComputedStyle(node).translate));
    expect(shift).toBeLessThan(0);
    expect(shift).toBeGreaterThanOrEqual(-24);
  });
  await swipe(page, area, fastFlick);
  await expect(dialog.getByText('4 von 4', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'PXL_20261014.jpg', exact: true })
  ).toBeVisible();
  await expect(media).toHaveCSS('translate', 'none');
});

test('an Instagram carousel in the post dialog moves to its next image', async ({ page }) => {
  await page.goto('/');
  const card = page.getByRole('link', { name: /Sommerlager 2026/ }).first();
  const dialog = page.getByRole('dialog');
  // The news island hydrates when it scrolls into view; until then the link goes to Instagram
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('xpath=ancestor::astro-island[1]')).not.toHaveAttribute('ssr');
  await card.click();
  await expect(dialog.getByRole('button', { name: 'Nächstes Bild' })).toBeVisible();
  await expect(dialog.getByText('1 / 5', { exact: true })).toBeVisible();
  const media = dialog.locator('.swipe-area');
  await swipe(page, media, fastFlick);
  await expect(dialog.getByText('2 / 5', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Bild 2 von 5', { exact: true })).toBeAttached();
  await swipe(page, media, slowShortDrag);
  await expect(dialog.getByText('2 / 5', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
