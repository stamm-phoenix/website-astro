import { test, expect } from './fixtures';

// The mock Aktionen are dated relative to MOCK_NOW (2026-10-01), like the browser's clock:
// the Sommerlager ended on 11.08.2026, the Stammesversammlung on 18.09.2026.

test('the start page lists the KJR deadlines of Aktionen that are over', async ({ page }) => {
  await page.goto('/leitendenbereich');
  const fristen = page.getByTestId('kjr-fristen');
  await expect(
    page.getByRole('heading', { name: 'Zuschussanträge beim KJR', level: 2 })
  ).toBeVisible();

  // Three months after the end, the earliest deadline first
  const items = fristen.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Sommerlager 2026 Oberjoch');
  await expect(items.nth(0)).toContainText('Ende 11.08.2026 · Abgabe bis 11.11.2026, noch 41 Tage');
  await expect(items.nth(1)).toContainText('Stammesversammlung');
  await expect(items.nth(1)).toContainText('Abgabe bis 18.12.2026, noch 78 Tage');
  // Neither coming Aktionen nor ones whose deadline has passed (Friedenslicht 2025)
  await expect(fristen).not.toContainText('Wölflings-Herbstwochenende');
  await expect(fristen).not.toContainText('Friedenslicht 2025');

  await fristen.getByRole('link', { name: 'Sommerlager 2026 Oberjoch' }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/abrechnung\/evt_Sola26$/);
});

test('a KJR deadline within two weeks is highlighted', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
  await page.goto('/leitendenbereich');
  const sola = page.getByTestId('kjr-fristen').getByRole('listitem').first();
  await expect(sola).toContainText('Abgabe bis 11.11.2026, noch 10 Tage');
  await expect(sola.getByText(/Abgabe bis/)).toHaveClass(/text-warning/);
});
