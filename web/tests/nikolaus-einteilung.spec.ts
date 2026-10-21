import { test, expect, answerConfirm } from './fixtures';

test('switching the view asks before an unsaved Einteilung is dropped', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-helfende/?ansicht=einteilung');
  await page.getByRole('button', { name: 'Neu berechnen', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
  ).toBeEnabled();

  const helfende = page.getByRole('button', { name: 'Helfende', exact: true });
  const einteilung = page.getByRole('button', { name: 'Einteilung', exact: true });
  await helfende.click();
  await answerConfirm(page, 'Ansicht wechseln?', 'Abbrechen');
  await expect(einteilung).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
  ).toBeEnabled();

  await helfende.click();
  await answerConfirm(page, 'Ansicht wechseln?', 'Änderungen verwerfen');
  await expect(helfende).toHaveAttribute('aria-pressed', 'true');
});
