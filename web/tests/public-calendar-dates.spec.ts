import { test, expect } from './fixtures';
import type { Aktion } from '../src/lib/types';

test.use({ timezoneId: 'America/Los_Angeles' });

test('a date-only event at a month boundary has one Berlin date in heading, badge and date line', async ({
  page,
}) => {
  const response = await page.request.get('/api/aktionen');
  const actions = (await response.json()) as Aktion[];
  await page.route('**/api/aktionen', (route) =>
    route.fulfill({
      json: [
        {
          ...actions[0],
          id: 'timezone-test',
          title: 'November-Termin',
          start: '2026-11-01',
          end: '2026-11-01',
        },
      ],
    })
  );
  await page.goto('/aktionen');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'November-Termin', exact: true }) });
  await expect(card).toBeVisible();
  await expect(page.getByRole('heading', { name: 'November', exact: true })).toBeVisible();
  await expect(card.locator('.date-badge')).toHaveText(/Nov\.?\s+1/);
  await expect(card).toContainText('Sonntag, 01. November 2026');
});
