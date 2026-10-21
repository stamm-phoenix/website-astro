import { expect, test } from './fixtures';

// The server says when a search hangs, so a wrong device clock cannot release a running one
for (const [name, geocoding, enabled] of [
  ['running', { owner: 'o1', startedAt: Date.now() - 60_000, stuckInMs: 540_000 }, false],
  ['hung', { owner: 'o1', startedAt: Date.now() + 3_600_000, stuckInMs: 0 }, true],
  ['unknown', { owner: 'o1', startedAt: null, stuckInMs: null }, 'checkbox'],
] as const) {
  test(`a ${name} address search can be released only when it hangs`, async ({ page }) => {
    await page.route('**/api/intern/nikolaus/steuerung', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), geocoding } });
    });
    await page.goto('/leitendenbereich/nikolaus-steuerung');
    const release = page.getByRole('button', { name: 'Sperre lösen' });
    await expect(release).toBeVisible();
    if (enabled === 'checkbox') {
      await expect(release).toBeDisabled();
      await page.getByRole('checkbox', { name: /mehr als zehn Minuten/ }).check();
      await expect(release).toBeEnabled();
    } else if (enabled) await expect(release).toBeEnabled();
    else await expect(release).toBeDisabled();
  });
}
