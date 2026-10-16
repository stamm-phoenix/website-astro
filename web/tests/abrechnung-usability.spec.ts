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

test('material days can be cleared and retyped without appending to the default', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=leihgebuehren');
  await page.getByLabel('Anzahl Jurte').fill('2');
  const days = page.getByLabel('Tage Jurte');
  await expect(days).toHaveValue('10');
  await days.fill('4');
  await days.press('Backspace');
  await expect(days).toHaveValue('');
  await days.pressSequentially('5');
  await expect(days).toHaveValue('5');
  await expect(page.getByTestId('leihgebuehren-summe')).toHaveText(/250,00\s€/);
  await days.press('Backspace');
  await days.press('Tab');
  await expect(days).toHaveValue('10');
  await expect(page.getByTestId('leihgebuehren-summe')).toHaveText(/500,00\s€/);
});

test('a changed postal code can be cleared and retyped without restoring the original mid-edit', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=teilnehmende');
  const plz = page.getByLabel('PLZ Gast München');
  await expect(plz).toHaveValue('80331');
  await plz.fill('83620');
  await plz.press('ControlOrMeta+A');
  await plz.press('Backspace');
  await expect(plz).toHaveValue('');
  await plz.pressSequentially('83043');
  await expect(plz).toHaveValue('83043');
  await expect(plz).toHaveAttribute('aria-invalid', 'false');
  await plz.press('ControlOrMeta+A');
  await plz.press('Backspace');
  await plz.press('Tab');
  await expect(plz).toHaveValue('80331');
});
