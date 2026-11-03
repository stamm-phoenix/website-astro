import { test, expect } from './fixtures';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });

test('holiday notice appears and disappears at Berlin midnight on an open phone page', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-01T22:59:50Z') });
  await page.goto('/gruppenstunden');
  // Wait for this client-only island to mount before advancing its timer.
  const island = page
    .locator('astro-island')
    .filter({ has: page.locator('[role="status"][aria-atomic="true"]') });
  await expect(island).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /Herbstferien/ })).toHaveCount(0);
  await page.clock.runFor(10_000);
  const notice = page.getByRole('region', { name: 'Herbstferien: Keine Gruppenstunden' });
  await expect(notice).toBeVisible();
  await expect(notice.locator('..')).toHaveAttribute('aria-live', 'polite');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('ferien-phone.png') });
  await page.clock.fastForward(5 * 24 * 60 * 60 * 1000);
  await expect(notice).toHaveCount(0);
});

test('Christmas remains active across New Year and a resumed tab refreshes its date', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-12-31T22:00:00Z'));
  await page.goto('/gruppenstunden');
  const notice = page.getByRole('heading', { name: 'Weihnachtsferien: Keine Gruppenstunden' });
  await expect(notice).toBeVisible();
  await page.clock.setFixedTime(new Date('2027-01-01T00:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notice).toBeVisible();
  await page.clock.setFixedTime(new Date('2027-01-08T23:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(notice).toHaveCount(0);
});

test('expired calendar asks visitors to check with their leaders', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2031-11-03T12:00:00Z'));
  await page.goto('/gruppenstunden');
  await expect(
    page.getByText('Ob deine Gruppenstunde stattfindet, erfährst du bei deinen Gruppenleitenden.')
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /Keine Gruppenstunden/ })).toHaveCount(0);
});
