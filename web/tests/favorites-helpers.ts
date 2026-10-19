import type { Page } from '@playwright/test';

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
    const before = await link.boundingBox();
    await page.waitForTimeout(150);
    box = await link.boundingBox();
    if (before && box && before.y === box.y) break;
  }
  if (!box) throw new Error(`${name} is not on screen`);
  const point = { x: box.x + 40, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  // Another touch right away would count as a double tap
  await page.waitForTimeout(400);
}
