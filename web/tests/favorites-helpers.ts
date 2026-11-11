import { expect, type Page } from '@playwright/test';
import { paintedFor, waitUntilStill } from './settle';

/**
 * Toggles an area as a favorite the way a person does: with a mouse by pointing at it in the
 * menu and clicking the star, on a touch screen by a long press on it in the list „Alle Bereiche“
 * of the start page (or in the sheet, if it is open).
 */
export async function toggleFavoriteLikeAPerson(page: Page, name: string): Promise<void> {
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (!coarse) {
    const star = page
      .getByRole('button', { name: `${name} als Favorit`, exact: true })
      .filter({ visible: true })
      .first();
    await star.locator('..').hover();
    await star.click();
    return;
  }
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  const place = (await sheet.isVisible())
    ? sheet
    : page.getByRole('region', { name: 'Alle Bereiche' });
  const link = place.getByRole('link', { name: new RegExp(`^${name}`) }).first();
  const star = link.locator('..').getByRole('button', { name: `${name} als Favorit`, exact: true });
  await expect(star).toBeAttached();
  const previous = await star.getAttribute('aria-pressed');
  // The cards above the list keep loading and push it down, out of the screen or under the bar at
  // the bottom. Press only where the area is on top at that very moment: scroll it into view
  // again until the point to press belongs to the link (a position that holds still is not enough)
  const pressed: { point?: { x: number; y: number } } = {};
  const cdp = await page.context().newCDPSession(page);
  await expect
    .poll(
      async () => {
        await link.evaluate((element) =>
          element.scrollIntoView({ block: 'center', behavior: 'instant' })
        );
        await waitUntilStill(link);
        const found = await link.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const x = box.x + 40;
          const y = box.y + box.height / 2;
          const top = document.elementFromPoint(x, y);
          return top && element.contains(top) ? { x, y } : null;
        });
        pressed.point = found ?? undefined;
        return found !== null;
      },
      { message: `${name} is not on top of the screen`, intervals: [0, 100, 250, 500] }
    )
    .toBe(true);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [pressed.point ?? { x: 0, y: 0 }],
  });
  try {
    // Keep the finger down until the long press has changed the favorite.
    await expect(star).toHaveAttribute('aria-pressed', previous === 'true' ? 'false' : 'true');
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  // Another touch right away would count as a double tap
  await paintedFor(page, 400);
}
