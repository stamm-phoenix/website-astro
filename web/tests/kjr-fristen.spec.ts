import { test, expect } from './fixtures';

// The mock Aktionen are dated relative to MOCK_NOW (2026-10-01), like the browser's clock:
// the Sommerlager ended on 11.08.2026, the Stammesversammlung on 18.09.2026.

test('the start page lists the KJR deadlines of Aktionen that are over', async ({ page }) => {
  await page.goto('/leitendenbereich');
  const fristen = page.getByTestId('kjr-fristen');
  await expect(page.getByRole('heading', { name: 'KJR-Fristen', level: 2 })).toBeVisible();

  // Three months after the end, the earliest deadline first
  const items = fristen.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Sommerlager 2026 Oberjoch');
  await expect(items.nth(0)).toContainText('Abgabe bis 11.11.2026, noch 41 Tage');
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

test('areas without entries collapse into a line instead of disappearing', async ({ page }) => {
  await page.route('**/api/intern/aktionen', (route) => route.fulfill({ json: [] }));
  await page.goto('/leitendenbereich');
  const nothingOpen = page.getByTestId('nothing-open');
  await expect(nothingOpen).toContainText('Keine kommenden Aktionen in CampFlow');
  await expect(nothingOpen).toContainText('Keine offenen KJR-Fristen');
  await expect(page.getByRole('heading', { name: 'KJR-Fristen' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nächste Aktionen' })).toHaveCount(0);
  // The tasks still have entries and keep their card
  await expect(page.getByRole('region', { name: 'Offene Aufgaben' })).toBeVisible();
});

test('the Abrechnung shows the KJR deadline of each Aktion', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung');
  const sola = page.getByRole('link', { name: /Sommerlager 2026 Oberjoch/ });
  await expect(sola.getByTestId('kjr-frist')).toHaveText('KJR-Abgabe bis 11.11.2026, noch 41 Tage');
  // Only Aktionen that are over have a deadline in the list
  await expect(
    page.getByRole('link', { name: /Wölflings-Herbstwochenende/ }).getByTestId('kjr-frist')
  ).toHaveCount(0);
  await page.getByRole('button', { name: /Archiviert/ }).click();
  await expect(
    page.getByRole('link', { name: /Friedenslicht 2025/ }).getByTestId('kjr-frist')
  ).toHaveText('KJR-Frist am 14.03.2026 abgelaufen');

  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(page.getByTestId('kjr-frist')).toHaveText(
    'Abgabe beim KJR bis 11.11.2026, noch 41 Tage'
  );
  // Coming Aktionen already show when their Abrechnung will be due
  await page.goto('/leitendenbereich/abrechnung/evt_WoeHerbst');
  await expect(page.getByTestId('kjr-frist')).toContainText('(3 Monate nach Ende)');
});

test('a KJR deadline within two weeks is highlighted in the Abrechnung', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const frist = page.getByTestId('kjr-frist');
  await expect(frist).toHaveText('Abgabe beim KJR bis 11.11.2026, noch 10 Tage');
  await expect(frist).toHaveClass(/text-warning/);
});
