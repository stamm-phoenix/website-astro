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
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number }[]
  ): Promise<unknown> => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  const step = (i: number): { x: number; y: number } =>
    point((gesture.distance * i) / gesture.steps);
  await send('touchStart', [point(0)]);
  for (let i = 1; i < gesture.steps; i++) {
    await sleep(gesture.interval);
    await send('touchMove', [step(i)]);
  }
  await sleep(gesture.interval);
  if (gesture.rest || hold) {
    await send('touchMove', [step(gesture.steps)]);
    await sleep(gesture.rest);
    if (hold) await hold();
    await send('touchEnd', []);
  } else {
    // A flick lets go right after its last move, even when the machine answers slowly
    await Promise.all([send('touchMove', [step(gesture.steps)]), send('touchEnd', [])]);
  }
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

/** Opens the five-image Instagram post of the mock data in its dialog. */
async function openInstagramPost(page: Page): Promise<{ dialog: Locator; media: Locator }> {
  await page.goto('/');
  const card = page.getByRole('link', { name: /Sommerlager 2026/ }).first();
  const dialog = page.getByRole('dialog');
  // The news island hydrates when it scrolls into view; until then the link goes to Instagram
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('xpath=ancestor::astro-island[1]')).not.toHaveAttribute('ssr');
  await card.click();
  await expect(dialog.getByRole('button', { name: 'Nächstes Bild' })).toBeVisible();
  await expect(dialog.getByText('1 / 5', { exact: true })).toBeVisible();
  return { dialog, media: dialog.locator('.swipe-area') };
}

/** Horizontal distance of image `n` (1-based, the first place showing it) from the carousel area. */
async function imageShift(media: Locator, n: number): Promise<number> {
  const area = await media.boundingBox();
  const image = await media
    .locator(`[data-image="${n - 1}"]`)
    .first()
    .boundingBox();
  if (!area || !image) throw new Error(`Image ${n} is not in the carousel`);
  return image.x - area.x;
}

/** Width of image `n` that lies inside the carousel area. */
async function visibleWidth(media: Locator, n: number): Promise<number> {
  const area = await media.boundingBox();
  const image = await media
    .locator(`[data-image="${n - 1}"]`)
    .first()
    .boundingBox();
  if (!area || !image) return 0;
  const left = Math.max(area.x, image.x);
  const right = Math.min(area.x + area.width, image.x + image.width);
  return Math.max(0, right - left);
}

test('an Instagram carousel shows the next image beside the current one while dragging', async ({
  page,
}) => {
  const { dialog, media } = await openInstagramPost(page);
  // The neighbours are loaded ahead, so the revealed image is there, not a placeholder
  await expect(media.locator('[data-image="1"] img')).toHaveCount(1);
  await swipe(page, media, slowLongDrag, async () => {
    const width = (await media.boundingBox())?.width ?? 0;
    // Both images share the area, edge to edge
    expect(await visibleWidth(media, 1)).toBeGreaterThan(20);
    expect(await visibleWidth(media, 2)).toBeGreaterThan(100);
    const gap = (await imageShift(media, 2)) - ((await imageShift(media, 1)) + width);
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    await expect(dialog.getByText('1 / 5', { exact: true })).toBeVisible();
  });
  await expect(dialog.getByText('2 / 5', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a flick moves the Instagram carousel on to its next image', async ({ page }) => {
  const { dialog, media } = await openInstagramPost(page);
  await swipe(page, media, fastFlick);
  // State changes on release, the strip then comes to rest with image 2 exactly in view
  await expect(dialog.getByText('2 / 5', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Bild 2 von 5', { exact: true })).toBeAttached();
  await expect.poll(async () => Math.abs(await imageShift(media, 2))).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
});

test('a short slow drag returns the Instagram carousel to its image', async ({ page }) => {
  const { dialog, media } = await openInstagramPost(page);
  await swipe(page, media, slowShortDrag);
  await expect(dialog.getByText('1 / 5', { exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs(await imageShift(media, 1))).toBeLessThanOrEqual(1);
});

test('swiping right on the first Instagram image wraps to the last one', async ({ page }) => {
  const { dialog, media } = await openInstagramPost(page);
  await swipe(page, media, { ...fastFlick, distance: 80 });
  await expect(dialog.getByText('5 / 5', { exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs(await imageShift(media, 5))).toBeLessThanOrEqual(1);
});

test('the arrow slides the Instagram carousel to its next image', async ({ page }) => {
  const { dialog, media } = await openInstagramPost(page);
  await dialog.getByRole('button', { name: 'Nächstes Bild' }).click();
  await expect(dialog.getByText('2 / 5', { exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs(await imageShift(media, 2))).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('button', { name: 'Nächstes Bild' })).toBeFocused();
});

interface Point {
  x: number;
  y: number;
}

/**
 * Touches with one or two fingers that move in a straight line from `from` to `to`
 * (one point per finger, relative to the centre of `area`).
 */
async function touchPath(
  page: Page,
  area: Locator,
  from: Point[],
  to: Point[],
  { steps = 12, interval = 25, rest = 200 } = {}
): Promise<void> {
  const box = await area.boundingBox();
  if (!box) throw new Error('Touch area is not visible');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const at = (share: number): { x: number; y: number; id: number }[] =>
    from.map((start, id) => ({
      x: centre.x + start.x + (to[id].x - start.x) * share,
      y: centre.y + start.y + (to[id].y - start.y) * share,
      id,
    }));
  const client: CDPSession = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await sleep(interval);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(i / steps),
    });
  }
  if (rest) await sleep(rest);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/** Two quick taps at the same spot, relative to the centre of `area`. */
async function doubleTap(page: Page, area: Locator, at: Point = { x: 0, y: 0 }): Promise<void> {
  const box = await area.boundingBox();
  if (!box) throw new Error('Touch area is not visible');
  const point = { x: box.x + box.width / 2 + at.x, y: box.y + box.height / 2 + at.y };
  const client: CDPSession = await page.context().newCDPSession(page);
  for (let i = 0; i < 2; i++) {
    if (i) await sleep(80);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await sleep(30);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await client.detach();
}

/** Scale and shift of the shown photo from its computed transform. */
async function photoZoom(area: Locator): Promise<{ scale: number; x: number }> {
  return area
    .locator('img')
    .first()
    .evaluate((node) => {
      const { transform } = getComputedStyle(node);
      if (transform === 'none') return { scale: 1, x: 0 };
      const matrix = new DOMMatrix(transform);
      return { scale: matrix.a, x: matrix.e };
    });
}

test('pulling the photo down past a fifth closes the view and returns focus', async ({ page }) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.getByRole('group', { name: /Wische zur Seite/ });
  const opener = page.getByRole('button', { name: 'IMG_4301.jpg groß anzeigen', exact: true });
  const box = await area.boundingBox();
  if (!box) throw new Error('Photo area is not visible');
  const distance = box.height * 0.3;
  await touchPath(page, area, [{ x: 0, y: -40 }], [{ x: 0, y: -40 + distance }]);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('a short pull down keeps the view open and returns the photo', async ({ page }) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.getByRole('group', { name: /Wische zur Seite/ });
  const media = area.locator('.swipe-media');
  await touchPath(page, area, [{ x: 0, y: -40 }], [{ x: 0, y: 20 }], { steps: 12, interval: 30 });
  await expect(dialog.getByRole('heading', { name: 'IMG_4301.jpg', exact: true })).toBeVisible();
  await expect(media).toHaveCSS('translate', 'none');
  // The background is dark again
  await expect(dialog).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});

test('a double tap zooms, one finger then moves the photo, a second double tap returns', async ({
  page,
}) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.locator('.swipe-area');
  await expect(area.locator('img').first()).toBeVisible();
  await doubleTap(page, area);
  await expect.poll(async () => (await photoZoom(area)).scale).toBeGreaterThan(2);
  await expect(dialog.getByRole('button', { name: 'Verkleinern' })).toBeVisible();

  const before = await photoZoom(area);
  await touchPath(page, area, [{ x: 60, y: 0 }], [{ x: -120, y: 0 }]);
  // Moved, not changed: the counter stays and the photo shifted to the left
  await expect(dialog.getByText('1 von 15', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'IMG_4301.jpg', exact: true })).toBeVisible();
  expect((await photoZoom(area)).x).toBeLessThan(before.x - 100);
  // Pulling down while zoomed moves the photo instead of closing the view
  await touchPath(page, area, [{ x: 0, y: -100 }], [{ x: 0, y: 200 }]);
  await expect(dialog).toBeVisible();

  await doubleTap(page, area);
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Vergrößern' })).toBeVisible();
  // Back at 1×, a sideways swipe changes the photo again
  await swipe(page, area, fastFlick);
  await expect(dialog.getByText('2 von 15', { exact: true })).toBeVisible();
});

test('two fingers zoom the photo in and out', async ({ page }) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.locator('.swipe-area');
  await expect(area.locator('img').first()).toBeVisible();
  await touchPath(
    page,
    area,
    [
      { x: -30, y: 0 },
      { x: 30, y: 0 },
    ],
    [
      { x: -100, y: 0 },
      { x: 100, y: 0 },
    ],
    { rest: 0 }
  );
  const zoomed = (await photoZoom(area)).scale;
  expect(zoomed).toBeGreaterThan(2.5);
  expect(zoomed).toBeLessThanOrEqual(4);
  await touchPath(
    page,
    area,
    [
      { x: -100, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: -20, y: 0 },
      { x: 20, y: 0 },
    ],
    { rest: 0 }
  );
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(1);
});

test('the zoom button works with the keyboard and the arrow keys move a zoomed photo', async ({
  page,
}) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.locator('.swipe-area');
  const counter = dialog.getByText('1 von 15', { exact: true });
  await dialog.getByRole('button', { name: 'Vergrößern' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Verkleinern' })).toBeFocused();
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(2.5);

  // While zoomed, the arrow keys move the photo instead of changing it, up to its edge
  const centre = (await photoZoom(area)).x;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await photoZoom(area)).x).toBeLessThan(centre);
  await expect(counter).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  // Each press moves for a moment; read the edge once the photo rests
  await page.waitForTimeout(400);
  const edge = (await photoZoom(area)).x;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  expect((await photoZoom(area)).x).toBe(edge);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await photoZoom(area)).x).toBeGreaterThan(edge);
  await expect(counter).toBeVisible();

  // Changing the photo shows the next one whole
  await dialog.getByRole('button', { name: 'Nächstes Foto' }).click();
  await expect(dialog.getByText('2 von 15', { exact: true })).toBeVisible();
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(1);
  // Not zoomed, the arrow keys change the photo again
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByText('3 von 15', { exact: true })).toBeVisible();
  const button = dialog.getByRole('button', { name: 'Vergrößern' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(2.5);
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Vergrößern' })).toBeFocused();
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(1);
});

test('a pinch to nearly whole whose fingers leave one by one returns to the whole photo', async ({
  page,
}) => {
  const dialog = await openFoto(page, SOLA, 'IMG_4301.jpg');
  const area = dialog.locator('.swipe-area');
  await expect(area.locator('img').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Vergrößern' }).click();
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(2.5);

  const box = (await area.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const fingers = (half: number): { x: number; y: number; id: number }[] => [
    { x: centre.x - half, y: centre.y, id: 0 },
    { x: centre.x + half, y: centre.y, id: 1 },
  ];
  const client: CDPSession = await page.context().newCDPSession(page);
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number; id: number }[]
  ) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', fingers(100));
  // 2.5 × 82 / 200 = 1.025: just above the whole photo
  for (const half of [90, 75, 60, 50, 41]) {
    await sleep(25);
    await send('touchMove', fingers(half));
  }
  await sleep(100);
  // The second finger lifts first, then the first one without moving
  await send('touchMove', [fingers(41)[0]]);
  await sleep(100);
  await send('touchEnd', []);
  await client.detach();
  await expect.poll(async () => (await photoZoom(area)).scale).toBe(1);

  // Whole again, a swipe changes the photo
  await swipe(page, area, slowLongDrag);
  await expect(dialog.getByText('2 von 15', { exact: true })).toBeVisible();
});

/** The five-image Instagram card of the mock data on the start page, once it can open the dialog. */
async function instagramTile(page: Page): Promise<{ card: Locator; tile: Locator }> {
  await page.goto('/');
  const card = page.getByRole('link', { name: /Sommerlager 2026/ }).first();
  await card.scrollIntoViewIfNeeded();
  // The news island hydrates when it scrolls into view; until then nothing follows the finger
  await expect(card.locator('xpath=ancestor::astro-island[1]')).not.toHaveAttribute('ssr');
  const tile = card.locator('.swipe-area');
  await expect(tile.locator('img').first()).toBeVisible();
  return { card, tile };
}

/** 1-based number of the image the dots of a tile mark as current. */
async function activeDot(tile: Locator): Promise<number> {
  return (
    (await tile
      .locator('.dot')
      .evaluateAll((dots) => dots.findIndex((dot) => dot.classList.contains('dot-active')))) + 1
  );
}

/** A tap without movement in the middle of `area`. */
async function tap(page: Page, area: Locator): Promise<void> {
  const box = await area.boundingBox();
  if (!box) throw new Error('Touch area is not visible');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const client: CDPSession = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await sleep(30);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test('a swipe on an Instagram card shows its next image without opening the post', async ({
  page,
}) => {
  const { tile } = await instagramTile(page);
  const dialog = page.getByRole('dialog');
  expect(await activeDot(tile)).toBe(1);
  // The neighbour slides in beside the current image while the finger moves
  await swipe(page, tile, slowLongDrag, async () => {
    expect(await visibleWidth(tile, 2)).toBeGreaterThan(60);
    expect(await activeDot(tile)).toBe(1);
  });
  await expect.poll(() => activeDot(tile)).toBe(2);
  await expect.poll(async () => Math.abs(await imageShift(tile, 2))).toBeLessThanOrEqual(1);
  await expect(tile.locator('[data-image="1"] img')).toHaveAttribute('alt', '');

  // A flick goes on; right after it, the click Safari sends for the touch does not open the post
  await swipe(page, tile, fastFlick);
  await tile.locator('[data-image="2"]').first().dispatchEvent('click');
  await expect.poll(() => activeDot(tile)).toBe(3);
  await sleep(300);
  await expect(dialog).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('a tap on an Instagram card still opens the post', async ({ page }) => {
  const { tile } = await instagramTile(page);
  await tap(page, tile);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('1 / 5', { exact: true })).toBeVisible();
});

test('a vertical drag on an Instagram card scrolls the page and keeps its image', async ({
  page,
}) => {
  const { tile } = await instagramTile(page);
  const before = await page.evaluate(() => window.scrollY);
  await touchPath(page, tile, [{ x: 10, y: 60 }], [{ x: 0, y: -120 }], { rest: 0 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 60);
  expect(await activeDot(tile)).toBe(1);
  await expect(tile.locator('.carousel-strip')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('once swiped, an Instagram card no longer advances by itself', async ({ page }) => {
  await page.clock.install();
  const { tile } = await instagramTile(page);
  await swipe(page, tile, fastFlick);
  await expect.poll(() => activeDot(tile)).toBe(2);
  // Well past the interval of every card (6 s plus up to 900 ms per card before it)
  await page.clock.runFor(20_000);
  await sleep(500);
  expect(await activeDot(tile)).toBe(2);
});
