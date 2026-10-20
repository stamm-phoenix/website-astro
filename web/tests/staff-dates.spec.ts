import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.use({ timezoneId: 'America/Los_Angeles', viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' });
});

test('the booking overview reports its update in Berlin time on a device abroad', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/nikolaus');
  await expect(page.getByText(/Stand: 14:00 Uhr/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('minutes history uses Berlin time on a device abroad', async ({ page }) => {
  await page.route('**/api/intern/pflege/protokolle', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items[0].lastModifiedAt = '2026-10-01T12:00:00Z';
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/protokolle');
  await expect(page.getByText(/Zuletzt geändert 01.10.2026, 14:00/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('virtual rental receipts get the Berlin calendar day after local midnight', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-01T22:30:00Z'));
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await page.getByRole('tab', { name: 'Leihgebühren' }).click();
  await page
    .getByRole('spinbutton', { name: /^Anzahl / })
    .first()
    .fill('1');
  await page.getByRole('tab', { name: 'Einzelnachweise' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Leihgebühren für Zelte und Material' });
  await expect(row).toContainText('02.10.2026');
});

test('minutes without a modification timestamp still render their list', async ({ page }) => {
  await page.route('**/api/intern/pflege/protokolle', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const item of data.items) item.lastModifiedAt = '';
    await route.fulfill({ response, json: data });
  });
  await page.goto('/leitendenbereich/protokolle');
  await expect(page.getByText(/Zuletzt geändert/).first()).toBeVisible();
  // The tasks load the same list; their request may still be in the handler when the test ends
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('internal action year and calendar month agree after Berlin New Year', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-12-31T23:30:00Z'));
  await page.goto('/leitendenbereich/aktionen');
  await expect(page.getByRole('combobox', { name: 'Jahr', exact: true })).toHaveValue('2027');
  await page.getByRole('button', { name: 'Monat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Januar 2027', exact: true })).toBeVisible();
});
