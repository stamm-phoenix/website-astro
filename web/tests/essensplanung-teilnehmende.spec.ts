import type { Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

/** The numbers of a meal in the table „Esser je Mahlzeit“: persons, portions, by diet. */
async function esser(page: Page, kennung: string): Promise<string[]> {
  const zeile = page
    .getByRole('table', { name: 'Esser je Mahlzeit' })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${kennung} `) }) });
  return zeile.getByRole('cell').allInnerTexts();
}

test('groups and participants give the eaters per meal', async ({ page }) => {
  await anlegen(page, 'E2E Teilnehmende');
  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  const dialog = page.getByRole('dialog');
  const gruppen = page.getByRole('list', { name: 'Gruppen' });

  // The groups of the template are there; a new one needs a sensible factor
  await expect(gruppen.getByRole('listitem')).toHaveCount(5);
  await expect(gruppen).toContainText('Faktor 0,7');
  await page.getByRole('button', { name: 'Gruppe hinzufügen' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Gäste');
  await dialog.getByLabel('Faktor', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog.getByText(/Bitte einen Faktor von 0,01 bis 5/)).toBeVisible();
  await dialog.getByLabel('Faktor', { exact: true }).fill('0,5');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(gruppen.getByRole('listitem')).toHaveCount(6);
  await expect(gruppen).toContainText('Faktor 0,5');

  // Ten Wölflinge all the time, four vegetarian Pfadis from lunch on the first day
  await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
  await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: 'Wö' });
  await dialog.getByLabel('Anzahl').fill('10');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('10 Wö gespeichert.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
  await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: 'Pfadi' });
  await dialog.getByLabel('Anzahl').fill('4');
  await dialog.getByLabel('Ernährung').selectOption('vegetarisch');
  await dialog.getByLabel('Gluten').check();
  await dialog.getByLabel('Ab', { exact: true }).selectOption({ label: '2_4 Abendessen' });
  await dialog.getByLabel('Bis', { exact: true }).selectOption({ label: '1_2 Mittagessen' });
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog.getByText('Bis liegt vor Von.')).toBeVisible();
  await dialog.getByLabel('Ab', { exact: true }).selectOption({ label: '1_2 Mittagessen' });
  await dialog.getByLabel('Bis', { exact: true }).selectOption({ label: '2_4 Abendessen' });
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();
  const pfadis = page.getByRole('list', { name: 'Teilnehmende Pfadi' });
  await expect(pfadis).toContainText(
    'vegetarisch · Unverträglichkeiten: Gluten · ab 1_2 Mittagessen bis 2_4 Abendessen'
  );
  await expect(page.getByText('Insgesamt 14 Personen')).toBeVisible();

  expect(await esser(page, '1_1')).toEqual(['10', '7', '10', '0', '0']);
  expect(await esser(page, '1_2')).toEqual(['14', '11', '10', '4', '0']);
  expect(await esser(page, '2_5')).toEqual(['10', '7', '10', '0', '0']);
  await expectNoHorizontalOverflow(page);

  // A group with participants cannot be deleted, an empty one can
  await expect(gruppen.getByRole('button', { name: 'Gruppe Wö löschen' })).toHaveCount(0);
  await gruppen.getByRole('button', { name: 'Gruppe Gäste löschen' }).click();
  await answerConfirm(page, 'Gruppe Gäste löschen?', 'Löschen');
  await expect(gruppen.getByRole('listitem')).toHaveCount(5);

  // The Wölflinge skip breakfast on the first day
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Wer isst mit? bei 1_1' }).click();
  await dialog.getByLabel('Wö').uncheck();
  await expect(page.getByText('Wö isst nicht bei 1_1 mit.').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByText('ohne Wö').first()).toBeVisible();

  // Deleting the first lunch moves the start of the Pfadis to the next meal
  await page.getByRole('button', { name: 'Mittagessen löschen' }).first().click();
  await answerConfirm(page, '1_2 Mittagessen löschen?', 'Mahlzeit löschen');
  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  await expect(pfadis).toContainText('ab 1_2 Kaffee & Kuchen bis 2_4 Abendessen');
  expect(await esser(page, '1_1')).toEqual(['0', '0', '0', '0', '0']);
  expect(await esser(page, '1_2')).toEqual(['14', '11', '10', '4', '0']);

  // Changing and removing a row
  await pfadis.getByRole('button', { name: '4 Pfadi vegetarisch ändern' }).click();
  await dialog.getByLabel('Anzahl').fill('6');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Insgesamt 16 Personen')).toBeVisible();
  await pfadis.getByRole('button', { name: '6 Pfadi vegetarisch entfernen' }).click();
  await answerConfirm(page, '6 Pfadi entfernen?', 'Entfernen');
  await expect(page.getByText('Insgesamt 10 Personen')).toBeVisible();
});
