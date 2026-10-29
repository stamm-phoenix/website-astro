import { readFile } from 'node:fs/promises';
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

test('the Einteilung downloads as a PDF, also as an unsaved draft', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-helfende/?ansicht=einteilung');
  await page.getByRole('button', { name: 'Neu berechnen', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen', exact: true }).click();
  await answerConfirm(page, 'Ungespeicherten Stand exportieren?', 'Trotzdem exportieren');
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/^nikolaus-einteilung-\d{4}-\d{2}-\d{2}\.pdf$/);
  const content = await readFile(await pdf.path());
  expect(content.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(
    page.getByText('PDF heruntergeladen. Die Einteilung ist noch nicht gespeichert.')
  ).toBeVisible();
});

test('the list of the Helfende downloads as a PDF', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-helfende/?ansicht=helfende');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen', exact: true }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/^nikolaus-helfende-\d{4}-\d{2}-\d{2}\.pdf$/);
  const content = await readFile(await pdf.path());
  expect(content.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByText('PDF heruntergeladen.', { exact: true })).toBeVisible();
});
