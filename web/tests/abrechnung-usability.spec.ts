import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('ended Aktionen with an open deadline come first under Jetzt abrechnen', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung');
  const current = page.getByRole('region', { name: 'Jetzt abrechnen', exact: true });
  await expect(
    current.getByRole('link', { name: 'Sommerlager 2026 Oberjoch', exact: true })
  ).toBeVisible();
  await expect(current.getByTestId('kjr-frist').first()).toContainText('Abgabe bis');
  const headings = await page.locator('main h2').allTextContents();
  expect(headings.indexOf('Jetzt abrechnen')).toBeLessThan(headings.indexOf('Geplant'));
  await page.getByRole('searchbox', { name: 'Suche' }).fill('Sommerlager');
  await expect(
    page.getByRole('link', { name: 'Sommerlager 2026 Oberjoch', exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('known postal codes, material counts and days are real field values', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=teilnehmende');
  const postalCode = page.getByLabel('PLZ Gast München');
  await expect(postalCode).toHaveValue('80331');
  await postalCode.fill('83620');
  await page
    .getByRole('button', { name: /Zurücksetzen/ })
    .first()
    .click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await expect(postalCode).toHaveValue('80331');
  await page.getByRole('tab', { name: /Leihgebühren/ }).click();
  await expect(page.getByLabel('Anzahl Kohte')).toHaveValue('0');
  await expect(page.getByLabel('Tage Kohte')).toHaveValue('10');
});

test('the care ratio warning explains the rule and the actual ratio', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(page.getByText(/höchstens 1 Betreuer\*in auf 8 Teilnehmende/)).toBeVisible();
  await expect(page.getByText(/bei euch 1 auf/)).toBeVisible();
  await expect(page.getByText(/Bemerkungsfeld/).first()).toBeVisible();
});
