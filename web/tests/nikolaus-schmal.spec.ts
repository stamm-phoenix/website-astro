import { test, expect, expectNoHorizontalOverflow, expectWithinWindowWidth } from './fixtures';

test('on a phone all five values of a Nikolaus day are visible', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus');
  await page.getByRole('heading', { name: 'Überblick über die Tage', exact: true }).click();
  const section = page.getByRole('region', { name: 'Überblick über die Tage', exact: true });
  const day = section.getByRole('row').nth(1);
  await expectWithinWindowWidth(page, day.getByRole('rowheader'));
  const cells = day.getByRole('cell');
  await expect(cells).toHaveCount(4);
  for (const cell of await cells.all()) await expectWithinWindowWidth(page, cell);
  // Without column headers on screen, each value carries its own label
  for (const [index, label] of ['Bestätigt', 'Ausstehend', 'Frei', 'Kinder'].entries()) {
    await expect(cells.nth(index)).toHaveText(new RegExp(`^${label}\\s*\\d+`));
  }
  await expectNoHorizontalOverflow(page);
});

test('on a phone the bookmark hint names the browser menu and keeps the token in the address bar', async ({
  page,
}) => {
  await page.goto('/nikolaus/termin#token=mock');
  await page.goto('/nikolaus/termin#main');
  await page.getByRole('button', { name: 'Als Lesezeichen speichern' }).click();
  await expect(page).toHaveURL(/\/nikolaus\/termin#token=mock$/);
  await expect(
    page.getByRole('status').filter({ hasText: /Lesezeichen hinzufügen/ })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
