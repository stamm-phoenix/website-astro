import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

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
  await expect(
    page.getByRole('status').filter({ hasText: 'als geprüft markiert.' })
  ).toBeVisible();
});
