import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
});

test('participant errors name their fields and clear while correcting them', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=teilnehmende');
  const form = page.getByRole('region', { name: 'Person nachtragen' });
  await form.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(form.getByLabel('Nachname', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await form.getByLabel('Vorname', { exact: true }).fill('Neue Person');
  await expect(form.getByLabel('Nachname', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await form.getByLabel(/^Alter(?: \(optional\))?$/).fill('x');
  await form.getByLabel(/^PLZ(?: \(optional\))?$/).fill('123');
  await form.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(form.getByLabel(/^Alter(?: \(optional\))?$/)).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(form.getByLabel(/^PLZ(?: \(optional\))?$/)).toHaveAttribute('aria-invalid', 'true');
  await form.getByLabel(/^Alter(?: \(optional\))?$/).fill('21');
  await form.getByLabel(/^PLZ(?: \(optional\))?$/).fill('83043');
  await expect(form.getByLabel(/^Alter(?: \(optional\))?$/)).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(form.getByLabel(/^PLZ(?: \(optional\))?$/)).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.screenshot({ path: `/tmp/278-participant-fields-${test.info().project.name}.png` });
  await form.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(page.getByRole('status').getByText(/Neue Person wurde nachgetragen/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const mode of ['status', 'item']) {
  test(`staff ${mode} conflict keeps the draft until confirmed reload`, async ({ page }) => {
    let saves = 0;
    const endpoint =
      mode === 'status'
        ? '**/api/intern/pflege/sammelbestellungen/orders/*'
        : '**/api/intern/pflege/sammelbestellungen/orders/*/item';
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      saves++;
      await route.fulfill({
        status: 409,
        json: { code: 'CONFLICT', message: 'Die Bestellung wurde inzwischen geändert.' },
      });
    });
    await page.goto('/leitendenbereich/sammelbestellungen/101');
    const row = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Mia Bauer', exact: true }) });
    await row
      .getByRole('button', {
        name: mode === 'status' ? 'Status bearbeiten' : 'Nicht mitbestellen',
        exact: true,
      })
      .first()
      .click();
    const editor = page.getByRole('dialog', {
      name: mode === 'status' ? 'Bestellstatus bearbeiten' : 'Artikel ausschließen',
      exact: true,
    });
    const input =
      mode === 'status'
        ? editor.getByLabel('Endgültiger Gesamtbetrag in Euro')
        : editor.getByLabel('Kommentar');
    const draft = mode === 'status' ? '12.34' : 'Mein ungespeicherter Kommentar';
    await input.fill(draft);
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(input).toHaveValue(draft);
    await expect(editor.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Aktuelle Fassung laden?', exact: true });
    await confirmation.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
    await expect(input).toHaveValue(draft);
    await editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Neu laden', exact: true }).click();
    await expect(input).not.toHaveValue(draft);
    await expect(editor.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
    expect(saves).toBe(1);
    await page.screenshot({ path: `/tmp/278-sammel-${mode}-${test.info().project.name}.png` });
    await expectNoHorizontalOverflow(page);
  });
}
