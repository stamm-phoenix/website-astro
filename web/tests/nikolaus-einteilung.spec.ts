import { test, expect } from './fixtures';

test('switching the view asks before an unsaved Einteilung is dropped', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-helfende/?ansicht=einteilung');
  await page.getByRole('button', { name: 'Neu berechnen' }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();

  const helfende = page.getByRole('button', { name: 'Helfende', exact: true });
  const einteilung = page.getByRole('button', { name: 'Einteilung', exact: true });
  const questions: string[] = [];
  page.once('dialog', (dialog) => {
    questions.push(dialog.message());
    void dialog.dismiss();
  });
  await helfende.click();
  expect(questions).toEqual([expect.stringContaining('noch nicht gespeichert')]);
  await expect(einteilung).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();

  page.once('dialog', (dialog) => void dialog.accept());
  await helfende.click();
  await expect(helfende).toHaveAttribute('aria-pressed', 'true');
});
