import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('Person aus Vorschlägen übernehmen, Teams wählen und eigenen Namen anlegen', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/intern/pflege/personen', (route) =>
    route.fulfill({
      json: {
        personen: [
          {
            id: 3,
            name: 'Dominik Alter Name',
            aktiv: true,
            gruppe: 'weitere',
            login: 'DOMINIK@EXAMPLE.DE',
          },
          { id: 1, name: 'Dominik Beispiel', aktiv: true, gruppe: 'weitere', login: '' },
          { id: 2, name: 'Dominik Inaktiv', aktiv: false, gruppe: 'weitere', login: '' },
        ],
        leitende: [{ login: 'dominik@example.de', name: 'Dominik Konto' }],
        campflow: [],
      },
    })
  );
  await page.goto('/leitendenbereich/leitende');
  await page.getByRole('button', { name: 'Neue Person', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('combobox', { name: 'Name', exact: true });
  await name.fill('Dominik Konto');
  await page.getByRole('option', { name: 'Dominik Konto', exact: true }).click();
  await expect(name).toHaveValue('Dominik Konto');
  await name.fill('Dominik');
  await expect(page.getByRole('option', { name: 'Dominik Beispiel' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Dominik Inaktiv' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Dominik Alter Name' })).toHaveCount(0);
  await name.press('ArrowDown');
  await name.press('Enter');
  await expect(name).toHaveValue('Dominik Konto');
  await dialog.getByRole('checkbox', { name: 'Vorstand', exact: true }).check();
  await expect(dialog.getByLabel('Telefon', { exact: false })).toBeVisible();
  await name.fill('Dominik');
  const option = page.getByRole('option', { name: 'Dominik Beispiel' });
  if (isMobile) await option.tap();
  else await option.click();
  await expect(name).toHaveValue('Dominik Beispiel');
  await name.fill('Eigener neuer Name');
  await expect(dialog.getByText('Keine passende Person gefunden.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).toContainText('Eigener neuer Name angelegt.');
});

test('Abgelaufene Anmeldung zeigt erneutes Anmelden und bewahrt den Namen', async ({ page }) => {
  await page.route('**/api/intern/pflege/personen', (route) =>
    route.fulfill({ status: 401, body: '' })
  );
  await page.goto('/leitendenbereich/leitende');
  await page.getByRole('button', { name: 'Neue Person', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('combobox', { name: 'Name', exact: true });
  await name.fill('Unfertiger Name');
  await expect(dialog.getByRole('link', { name: /Neu anmelden/ })).toBeVisible();
  await expect(name).toHaveValue('Unfertiger Name');
  await expect(dialog.getByRole('button', { name: 'Anlegen', exact: true })).toBeEnabled();
});
