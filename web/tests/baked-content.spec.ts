import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/** The public lists whose content is baked into the pages at build time. */
const BAKED_ENDPOINTS = [
  '/api/gruppenstunden',
  '/api/vorstand',
  '/api/aktionen',
  '/api/blog',
  '/api/downloads',
  '/api/qa',
  '/api/instagram',
];

/** Lets the refresh in the browser fail, as if the API were down. */
async function blockContentApi(page: Page): Promise<void> {
  await page.route(
    (url) => BAKED_ENDPOINTS.some((path) => url.pathname === path || url.pathname === `${path}/`),
    (route) => route.abort()
  );
}

function collectHydrationWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (/hydrat/i.test(message.text())) warnings.push(message.text());
  });
  return warnings;
}

test('public pages show the baked content even when the API is down', async ({ page }) => {
  const warnings = collectHydrationWarnings(page);
  await blockContentApi(page);

  await page.goto('/gruppenstunden');
  await expect(page.getByRole('heading', { name: 'Wölflinge', level: 2 })).toBeVisible();
  await expect(page.getByText('Daten konnten nicht geladen werden')).toHaveCount(0);

  await page.goto('/vorstand');
  await expect(page.getByRole('heading', { name: 'Katharina Huber' })).toBeVisible();
  await expect(page.locator('img[alt="Katharina Huber"]')).toHaveAttribute('src', /^\/baked\//);

  await page.goto('/aktionen');
  await expect(page.getByRole('heading', { name: 'Hike durchs Mangfalltal' })).toBeVisible();
  // Past Aktionen are left out, also when the baked list is older than today
  await expect(page.getByText('Stammesversammlung mit Wahl des Vorstands')).toHaveCount(0);

  await page.goto('/fragen-und-antworten');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.goto('/downloads');
  await expect(page.getByTestId('downloads-grid').locator('article').first()).toBeVisible();
  await expect(page.getByTestId('downloads-grid').locator('img').first()).toHaveAttribute(
    'src',
    /^\/baked\//
  );

  await page.goto('/');
  const news = page.locator('section[aria-labelledby="news-heading"]');
  await expect(news.getByRole('status')).toHaveCount(0);
  await expect(news.locator('img').first()).toHaveAttribute('src', /^\/baked\//);

  expect(warnings).toEqual([]);
});

test('the content is rendered into the HTML, not only in the browser', async ({ request }) => {
  const gruppenstunden = await (await request.get('/gruppenstunden')).text();
  expect(gruppenstunden).toContain('Wölflinge');
  expect(gruppenstunden).not.toContain('Gruppenstunden werden geladen');

  const post = await (await request.get('/blog/14/')).text();
  expect(post).toContain('Sommerlager 2026: Zehn Tage Abenteuer im Allgäu');
  expect(post).toContain('Aufbau im Regen');
  expect(post).toMatch(/<meta property="og:image" content="[^"]*\/baked\//);
});

test('blog posts have their own page and old links lead there', async ({ page }) => {
  await page.goto('/blog/beitrag?id=14');
  await expect(page).toHaveURL(/\/blog\/14\/$/);
  await expect(
    page.getByRole('heading', { name: 'Sommerlager 2026: Zehn Tage Abenteuer im Allgäu' })
  ).toBeVisible();
  await expect(page.locator('.blog-content img').first()).toHaveAttribute('src', /^\/baked\//);

  await page.goto('/blog');
  await page.getByRole('link', { name: 'Sommerlager 2026: Zehn Tage Abenteuer im Allgäu' }).click();
  await expect(page).toHaveURL(/\/blog\/14\/$/);
});

test('a withdrawn post disappears before the next build', async ({ page }) => {
  await page.route('**/api/blog/14', (route) =>
    route.fulfill({
      status: 404,
      json: { error: 'NOT_FOUND', message: 'Der Beitrag wurde nicht gefunden.' },
    })
  );
  await page.goto('/blog/14/');
  await expect(page.getByRole('heading', { name: 'Beitrag nicht gefunden' })).toBeVisible();
  await expect(page.getByText('Aufbau im Regen')).toHaveCount(0);
});

test('the browser refresh replaces the baked content with the current one', async ({ page }) => {
  await page.route('**/api/vorstand', (route) =>
    route.fulfill({
      json: [{ id: '999', name: 'Neue Vorständin', telephone: '08063 1', hasImage: false }],
    })
  );
  await page.goto('/vorstand');
  await expect(page.getByRole('heading', { name: 'Neue Vorständin' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Katharina Huber' })).toHaveCount(0);
});
