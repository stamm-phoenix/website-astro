import { test, expect } from './fixtures';

test('the writer gives minutes to the review; saving stops and the PDF is a draft', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Review');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();

  // Typed right before: saved first, then given to the review
  await page.getByLabel('Text zu Punkt 2.').fill('Alles fertig besprochen.');
  await page.getByRole('button', { name: 'Zum Review geben' }).click();
  const confirm = page.getByRole('dialog', { name: 'Zum Review geben?' });
  await confirm.getByRole('button', { name: 'Zum Review geben' }).click();
  await expect(confirm).toBeHidden();

  const review = page.getByRole('region', { name: 'Review und Versand' });
  await expect(review.getByText('Im Review', { exact: true })).toBeVisible();
  await expect(page.getByText('Alles fertig besprochen.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
  // The own minutes are approved by someone else
  await expect(review.getByText('Dein eigenes Protokoll gibt jemand anderes frei.')).toBeVisible();
  await expect(review.getByRole('button', { name: 'Freigeben' })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await review.getByRole('button', { name: 'PDF-Vorschau' }).click();
  expect((await download).suggestedFilename()).toMatch(/Leitendenrunde Review\.pdf$/);
});

test('a reviewer approves minutes and sends them to all leaders', async ({ page }) => {
  await page.goto('/leitendenbereich/protokolle');
  await page
    .getByRole('region', { name: 'Im Editor' })
    .getByRole('link', { name: 'Stavo-Sitzung', exact: true })
    .click();
  const review = page.getByRole('region', { name: 'Review und Versand' });
  await expect(review.getByText('Im Review', { exact: true })).toBeVisible();

  await review.getByRole('button', { name: 'Freigeben' }).click();
  const approve = page.getByRole('dialog', { name: 'Protokoll freigeben?' });
  // Approving deletes nothing, so it is not shown as a red danger button
  await expect(approve.getByRole('button', { name: 'Freigeben' })).toHaveClass(/btn-primary/);
  await approve.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approve).toBeHidden();
  await expect(review.getByText('Freigegeben', { exact: true })).toBeVisible();
  await expect(review.getByRole('link', { name: /Im Protokoll-Ordner öffnen/ })).toBeVisible();
  await expect(review.getByText(/Freigegeben von leitung@example\.test/)).toBeVisible();

  await review.getByRole('button', { name: 'An alle Leitenden schicken' }).click();
  const send = page.getByRole('dialog', { name: 'An alle Leitenden schicken?' });
  await send.getByRole('button', { name: 'An 23 Leitende schicken' }).click();
  await expect(send).toBeHidden();
  await expect(review.getByText('Verschickt', { exact: true })).toBeVisible();
  await expect(review.getByText(/An 23 Leitende verschickt am/)).toBeVisible();
  await expect(review.getByRole('button', { name: 'PDF herunterladen' })).toBeVisible();
});
