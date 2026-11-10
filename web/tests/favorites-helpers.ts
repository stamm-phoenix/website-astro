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
  // The page may still be filling in above; press only once the area holds still
  let box = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await link.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    );
    await waitUntilStill(link);
    box = await link.boundingBox();
    if (box) break;
  }
  if (!box) throw new Error(`${name} is not on screen`);
  const star = link.locator('..').getByRole('button', { name: `${name} als Favorit`, exact: true });
  await expect(star).toBeAttached();
  const previous = await star.getAttribute('aria-pressed');
  const point = { x: box.x + 40, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
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
