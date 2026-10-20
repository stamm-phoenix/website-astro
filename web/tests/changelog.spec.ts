import { test, expect } from './fixtures';
import { CHANGELOG } from '../src/lib/changelogEntries';

const SEEN_ALL = CHANGELOG[0].id;
const SEEN_OLDER = CHANGELOG[2].id;

test.afterEach(async ({ page }) => {
  // Other files of the worker expect an account that has read everything
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_ALL } });
});

test('unread news show a count at the menu, opening them marks them read', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_OLDER } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich');

  const menu = page
    .getByRole('navigation', { name: 'Schnellzugriff' })
    .getByRole('button', { name: 'Menü', exact: true });
  await expect(menu.getByTestId('changelog-badge')).toHaveText('2');
  await expect(menu).toHaveAccessibleDescription('2 neue Neuigkeiten');

  const notice = page.getByRole('status').filter({ hasText: '2 neue Neuigkeiten' });
  await notice.getByRole('link', { name: 'Neuigkeiten lesen' }).click();
  await expect(page.getByRole('heading', { level: 2, name: CHANGELOG[0].title })).toBeVisible();
  await expect(page.getByText('2 Neuigkeiten für dich.')).toBeVisible();
  await expect(page.getByText('Neu', { exact: true })).toHaveCount(2);

  // The next page no longer counts them
  await page.goto('/leitendenbereich');
  await expect(page.getByRole('link', { name: 'Neuigkeiten lesen' })).toHaveCount(0);
  await expect(menu).toHaveAccessibleDescription('');
  await expect(page.getByTestId('changelog-badge')).toHaveCount(0);
});

test('a person who has read everything is told so', async ({ page }) => {
  await page.request.post('/api/__mock/neuigkeiten/reset', { data: { lastSeenId: SEEN_ALL } });
  await page.goto('/leitendenbereich/neuigkeiten');
  await expect(page.getByText('Du bist auf dem neuesten Stand.')).toBeVisible();
  await expect(page.getByText('Neu', { exact: true })).toHaveCount(0);
});
