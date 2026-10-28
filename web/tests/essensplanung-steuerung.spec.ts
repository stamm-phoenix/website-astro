import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';

test('the Steuerung saves who may create Planungen and the templates', async ({ page }) => {
  await page.goto('/leitendenbereich/essensplanung-steuerung');
  await expect(page.getByRole('heading', { name: 'Wer darf Planungen anlegen?' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const save = page.getByRole('button', { name: 'Einstellungen speichern' });
  await expect(save).toBeDisabled();

  await page.getByRole('checkbox', { name: /Externe dürfen/ }).check();
  await page.getByLabel(/Erlaubte Adressen und Domains/).fill('kein eintrag');
  await save.click();
  await expect(page.getByText(/Bitte eine Mailadresse/)).toBeVisible();

  await page.getByLabel(/Erlaubte Adressen und Domains/).fill('dpsg-bezirk.de');
  await page.getByRole('button', { name: 'Gruppe hinzufügen' }).click();
  await page.getByLabel('Name', { exact: true }).last().fill('Küchenteam');
  await page.getByLabel('Faktor', { exact: true }).last().fill('1,1');
  await save.click();
  await expect(
    page.getByText('Einstellungen gespeichert. Sie gelten ab sofort.').first()
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(
    page
      .getByText('Anlegen durch Externe an, Erlaubte Adressen geändert, Vorlage Gruppen geändert')
      .first()
  ).toBeVisible();

  // Restore the demo state for the following tests of this worker
  await page.getByRole('checkbox', { name: /Externe dürfen/ }).uncheck();
  await page.getByLabel(/Erlaubte Adressen und Domains/).fill('');
  await page.getByRole('button', { name: 'Gruppe Küchenteam entfernen' }).click();
  await save.click();
  await expect(save).toBeDisabled();
});

test('the maintenance mode asks before it is switched on', async ({ page }) => {
  await page.goto('/leitendenbereich/essensplanung-steuerung');
  const save = page.getByRole('button', { name: 'Einstellungen speichern' });
  await page.getByRole('checkbox', { name: /Wartungsmodus/ }).check();
  await save.click();
  await answerConfirm(page, 'Wartungsmodus einschalten?', 'Weiter bearbeiten');
  await expect(save).toBeEnabled();
  await page.getByRole('checkbox', { name: /Wartungsmodus/ }).uncheck();
  await expect(save).toBeDisabled();
});

test('ingredients are filtered, checked and added', async ({ page }) => {
  await page.goto('/leitendenbereich/essensplanung-steuerung');
  const status = page.getByText(/von \d+ Zutaten/);
  await expect(status).toBeVisible();

  await page.getByLabel('Zutat suchen').fill('Honig');
  // „Honigmelone“ matches as well
  await expect(status).toHaveText('2 von 433 Zutaten');
  const honig = page
    .getByRole('listitem')
    .filter({ has: page.getByText('Honig', { exact: true }) });
  await expect(honig).toContainText('vegetarisch');
  await expect(honig).toContainText('Merkmale ungeprüft');

  await page.getByRole('button', { name: 'Bearbeiten: Honig', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat bearbeiten' });
  await expect(dialog.getByLabel('Ernährung', { exact: true })).toHaveValue('vegetarisch');
  await dialog.getByLabel('Ernährung und Allergene sind geprüft').check();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(honig).not.toContainText('Merkmale ungeprüft');

  await page.getByLabel('Zutat suchen').fill('');
  await page.getByRole('button', { name: 'Neue Zutat' }).click();
  const neu = page.getByRole('dialog', { name: 'Neue Zutat' });
  await neu.getByLabel('Name', { exact: true }).fill('Honig');
  await neu.getByLabel('Kategorie').selectOption({ label: 'Sonstiges' });
  await neu.getByRole('button', { name: 'Speichern' }).click();
  await expect(neu.getByText('Eine Zutat mit diesem Namen gibt es schon.')).toBeVisible();

  await neu.getByLabel('Name', { exact: true }).fill('Testzutat Dinkel');
  await neu.getByLabel('Ernährung', { exact: true }).selectOption('vegan');
  await neu.getByLabel('Gluten', { exact: true }).check();
  await neu.getByRole('button', { name: 'Speichern' }).click();
  await expect(neu).toHaveCount(0);
  await page.getByLabel('Zutat suchen').fill('Testzutat Dinkel');
  await expect(
    page.getByRole('listitem').filter({ has: page.getByText('Testzutat Dinkel', { exact: true }) })
  ).toContainText('enthält Gluten');

  // Remove the new ingredient again for the following tests of this worker
  await page.getByRole('button', { name: 'Bearbeiten: Testzutat Dinkel' }).click();
  await page
    .getByRole('dialog', { name: 'Zutat bearbeiten' })
    .getByRole('button', { name: 'Löschen' })
    .click();
  await answerConfirm(page, 'Zutat „Testzutat Dinkel“ löschen?', 'Löschen');
  await expect(status).toHaveText('0 von 433 Zutaten');

  // The mobile run shares the demo state: Honig is unchecked again
  await page.getByLabel('Zutat suchen').fill('Honig');
  await page.getByRole('button', { name: 'Bearbeiten: Honig', exact: true }).click();
  const zurueck = page.getByRole('dialog', { name: 'Zutat bearbeiten' });
  await zurueck.getByLabel('Ernährung und Allergene sind geprüft').uncheck();
  await zurueck.getByRole('button', { name: 'Speichern' }).click();
  await expect(zurueck).toHaveCount(0);
});

test('used categories and the EU allergens cannot be deleted', async ({ page }) => {
  await page.goto('/leitendenbereich/essensplanung-steuerung');
  await page.getByRole('button', { name: 'Bearbeiten: Backware' }).click();
  const kategorie = page.getByRole('dialog', { name: 'Kategorie bearbeiten' });
  await expect(kategorie.getByText(/Löschen geht erst/)).toBeVisible();
  await expect(kategorie.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
  await kategorie.getByRole('button', { name: 'Abbrechen' }).click();

  await page.getByRole('button', { name: 'Bearbeiten: Gluten', exact: true }).click();
  const allergen = page.getByRole('dialog', { name: 'Unverträglichkeit bearbeiten' });
  await expect(allergen.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
  await allergen.getByRole('button', { name: 'Abbrechen' }).click();
});
