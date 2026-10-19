import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the Beiträge show who has paid for an Aktion, read-only', async ({ page }) => {
  await page.goto('/leitendenbereich/beitraege');
  const sammlungen = page.getByRole('list', { name: 'Sammlungen' });
  await expect(sammlungen.getByRole('link')).toHaveCount(4);
  const lager = sammlungen.getByRole('link', { name: /Sommerlager 2026 Oberjoch/ });
  await expect(lager).toContainText('8 von 11 bezahlt · 1 storniert');
  await expect(lager).toContainText(/450,00\s€ offen/);
  await expect(lager).toContainText(/20,00\s€ zu erstatten/);
  await expect(page.getByTestId('beitraege-stand')).toContainText('Stand aus CampFlow');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('checkbox', { name: 'Erledigte ausblenden' }).check();
  await expect(sammlungen.getByRole('link', { name: /Hike 2026/ })).toHaveCount(0);

  await lager.click();
  await expect(page).toHaveURL(/\?sammlung=bat_Sola26$/);
  await expect(page.getByRole('heading', { name: 'Sommerlager 2026 Oberjoch' })).toBeVisible();
  const beitraege = page.getByRole('list', { name: 'Beiträge' });
  await expect(beitraege.getByRole('listitem')).toHaveCount(12);
  await expect(page.getByText('Teilweise bezahlt', { exact: false })).toBeVisible();
  // CampFlow counts cancelled Beiträge as settled; the overview must not call them paid.
  // Nothing on the page changes CampFlow.
  await expect(page.locator('main form, main [contenteditable]')).toHaveCount(0);

  await page.getByRole('button', { name: /Noch offen/ }).click();
  await expect(beitraege.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('beitraege-summe')).toContainText(/offen 450,00\s€/);
  await expectNoHorizontalOverflow(page);

  // The back button returns to the overview.
  await page.getByRole('link', { name: '← Alle Sammlungen' }).press('Enter');
  await expect(page.getByRole('heading', { name: /Sammlungen/ })).toBeFocused();
  await lager.press('Enter');
  await expect(page.getByRole('heading', { name: 'Sommerlager 2026 Oberjoch' })).toBeFocused();
  await page.goBack();
  await expect(page.getByRole('heading', { name: /Sammlungen/ })).toBeVisible();
});

test('all Beiträge can be filtered by Kostenstelle and searched', async ({ page }) => {
  await page.goto('/leitendenbereich/beitraege?ansicht=alle');
  await expect(page.getByRole('heading', { name: 'Alle Beiträge' })).toBeVisible();
  const beitraege = page.getByRole('list', { name: 'Beiträge' });
  await expect(beitraege.getByRole('listitem')).toHaveCount(32);

  await page.getByLabel('Kostenstelle').selectOption({ label: 'Allgemein' });
  await expect(beitraege.getByRole('listitem')).toHaveCount(10);
  await page.getByRole('button', { name: /Zu erstatten/ }).click();
  await expect(beitraege.getByRole('listitem')).toHaveCount(1);
  await expect(beitraege).toContainText(/20,00\s€ zu viel bezahlt/);

  await page.getByRole('button', { name: /^Alle/ }).click();
  await page.getByLabel('Suche').fill('gibt es nicht');
  await expect(page.getByText('Kein Beitrag passt zur Suche.')).toBeVisible();
});

test('„Neu aus CampFlow laden“ reads CampFlow again and says so', async ({ page }) => {
  await page.goto('/leitendenbereich/beitraege');
  await expect(page.getByTestId('beitraege-stand')).toBeVisible();
  const request = page.waitForRequest((r) => r.url().includes('/intern/beitraege?refresh=true'));
  await page.getByRole('button', { name: 'Neu aus CampFlow laden' }).click();
  await request;
  await expect(page.getByText('Beiträge neu aus CampFlow geladen.')).toBeVisible();
});

test('„Erneut versuchen“ after a failed reload asks CampFlow again', async ({ page }) => {
  await page.goto('/leitendenbereich/beitraege');
  await expect(page.getByTestId('beitraege-stand')).toBeVisible();
  let fail = true;
  await page.route('**/api/intern/beitraege?refresh=true', (route) =>
    fail
      ? route.fulfill({
          status: 502,
          json: {
            error: 'BEITRAEGE_UNAVAILABLE',
            code: 'BEITRAEGE_UNAVAILABLE',
            message: 'CampFlow antwortet nicht.',
          },
        })
      : route.fallback()
  );
  await page.getByRole('button', { name: 'Neu aus CampFlow laden' }).click();
  await expect(page.getByText('CampFlow antwortet nicht.')).toBeVisible();
  fail = false;
  const retry = page.waitForRequest((r) => r.url().includes('/intern/beitraege?refresh=true'));
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await retry;
  await expect(page.getByText('Beiträge neu aus CampFlow geladen.')).toBeVisible();
});
