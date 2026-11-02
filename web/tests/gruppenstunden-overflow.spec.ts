import { test, expect } from './fixtures';

test('wraps long active notices inside the card on a phone', async ({ page }) => {
  const longMessage = 'Hinweis'.repeat(80);
  const longLocation = 'Ort'.repeat(40);
  const longTime = 'Zeit'.repeat(15);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/gruppenstunden', async (route) => {
    const response = await route.fetch();
    const groups = await response.json();
    groups[0].exception = {
      startDate: '2026-01-01',
      endDate: '2099-12-31',
      message: longMessage,
      location: longLocation,
      time: longTime,
    };
    await route.fulfill({ response, json: groups });
  });

  await page.goto('/gruppenstunden');
  const card = page.locator('article.gruppe-card').first();
  const notice = card.getByRole('note');
  await expect(notice).toBeVisible();

  await expect
    .poll(() => notice.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await expect
    .poll(() => card.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await expect
    .poll(() =>
      card.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth;
      })
    )
    .toBe(true);
});
