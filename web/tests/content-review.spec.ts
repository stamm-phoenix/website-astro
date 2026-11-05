import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/api/intern/pflege/content-review/reset`);
  expect(response.ok()).toBe(true);
});

test('review overview filters and marks one content item on a phone', async ({ page }) => {
  await page.goto('/leitendenbereich/redaktion');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Redaktionsübersicht');
  const cards = page.locator('main li.surface');
  await expect(cards).toHaveCount(6);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Ungeprüft', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.getByLabel('Bereich', { exact: true }).selectOption('blog');
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Als geprüft markieren', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '„Sommerlager am See“ als geprüft markiert.' })
  ).toBeVisible();
  await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.getByText('Du (Testdaten)', { exact: false })).toBeVisible();
  await page.getByLabel('Bereich', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Prüfung fällig', exact: true }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByLabel('Bereich', { exact: true }).selectOption('aktion');
  await page.getByRole('button', { name: 'Erklärung zu Website-Inhalte der Aktion' }).click();
  await expect(
    page.getByText('Titel und Termine aus CampFlow sind davon ausgenommen.', { exact: false })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('failed review keeps the item and offers reload', async ({ page }) => {
  await page.route('**/api/intern/pflege/content-review/*/*', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Der Eintrag wurde inzwischen geändert. Lade die Übersicht neu.',
      }),
    })
  );
  await page.goto('/leitendenbereich/redaktion');
  await page.getByLabel('Bereich', { exact: true }).selectOption('faq');
  await page.getByRole('button', { name: 'Als geprüft markieren', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Lade die Übersicht neu');
  await expect(
    page.getByRole('button', { name: 'Als geprüft markieren', exact: true })
  ).toBeEnabled();
  await page.unroute('**/api/intern/pflege/content-review/*/*');
  await page.getByRole('button', { name: 'Als geprüft markieren', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'als geprüft markiert.' })).toBeVisible();
});

test('returning through Astro navigation reloads changed content', async ({ page }) => {
  let loads = 0;
  await page.route('**/api/intern/pflege/content-review', async (route) => {
    const response = await route.fetch();
    const items = await response.json();
    loads++;
    if (loads > 1) items[0].title = 'Inzwischen bearbeitet';
    await route.fulfill({ response, json: items });
  });
  await page.goto('/leitendenbereich/redaktion');
  await expect(page.locator('main li.surface')).toHaveCount(6);
  await page.locator('main li.surface').first().getByRole('link').click();
  await expect(page).not.toHaveURL(/redaktion/);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/leitendenbereich/redaktion';
    document.body.append(link);
    link.click();
  });
  await expect(page.getByRole('heading', { name: 'Inzwischen bearbeitet' })).toBeVisible();
  expect(loads).toBeGreaterThan(1);
});

test('expired session offers sign-in after a successful overview load', async ({ page }) => {
  await page.goto('/leitendenbereich/redaktion');
  await expect(page.locator('main li.surface')).toHaveCount(6);
  await page.route('**/api/intern/pflege/content-review/*/*', route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.locator('main li.surface').first().getByRole('button', {
    name: 'Als geprüft markieren', exact: true,
  }).click();
  await expect(page.getByRole('alert').getByRole('link', { name: /Neu anmelden/ })).toBeVisible();
});
