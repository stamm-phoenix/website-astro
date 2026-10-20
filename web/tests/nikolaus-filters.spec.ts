import { test, expect } from './fixtures';

test('booking filters start collapsed, count changes and reset the list', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  const filters = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Filter \(/ }) });
  await expect(filters).toBeVisible();
  await expect(filters).not.toHaveAttribute('open');
  await expect(filters.locator('summary')).toContainText('Filter (1 aktiv)');
  await expect(page.getByRole('searchbox', { name: 'Suche' })).toBeVisible();
  await filters.locator('summary').click();
  await filters.getByRole('combobox', { name: 'Krampus', exact: true }).selectOption('ja');
  await expect(filters.locator('summary')).toContainText('Filter (2 aktiv)');
  await page.getByRole('searchbox', { name: 'Suche' }).fill('unbekanntefamilie');
  await expect(filters.locator('summary')).toContainText('Filter (3 aktiv)');
  await expect(
    page.getByText('Keine Anmeldungen für diese Filter.', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).first().click();
  await expect(filters.locator('summary')).toContainText('Filter (0 aktiv)');
  await expect(page.getByRole('searchbox', { name: 'Suche' })).toHaveValue('');
  await expect(filters.getByRole('button', { name: 'Storniert', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(filters.getByRole('button', { name: 'Abgelaufen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: /Familie Huber/ })).toBeVisible();
});

test('on a phone the day overview can expand without pushing bookings off the initial screen', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Desktop keeps the day overview expanded.');
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  const overview = page
    .locator('details')
    .filter({ has: page.getByRole('heading', { name: 'Überblick über die Tage', exact: true }) });
  await expect(overview).toBeVisible();
  await expect(overview).not.toHaveAttribute('open');
  await expect(page.getByRole('button', { name: /Familie Huber/ })).toBeInViewport();
  await overview.locator('summary').click();
  await expect(overview.getByText('Bestätigt', { exact: true }).first()).toBeVisible();
  await expect(overview.getByText('Frei', { exact: true }).first()).toBeVisible();
  await expect(overview.getByText('Kinder', { exact: true }).first()).toBeVisible();
});
