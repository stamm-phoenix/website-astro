import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('leaders check in children, add a guest and save what they did', async ({ page }) => {
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: /Anwesenheit/ }).click();
  await expect(page.getByRole('heading', { name: 'Anwesenheit', level: 1 })).toBeVisible();

  // The demo login leads the Wölflinge; the date is their last Gruppenstunde (Fridays)
  await expect(page.getByRole('button', { name: 'Wölflinge' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('heading', { name: /^Wölflinge am Freitag, / })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const anna = page.getByRole('button', { name: 'Anna Test' });
  await expect(anna).toHaveAttribute('aria-pressed', 'false');
  await anna.click();
  await expect(anna).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1 Kind da.', { exact: true })).toBeVisible();

  await page.getByLabel('Gast hinzufügen').fill('Testgast Schnuppern');
  await page.getByRole('button', { name: 'Eintragen' }).click();
  await expect(
    page.getByText('Testgast Schnuppern ist als Gast eingetragen.').first()
  ).toBeVisible();
  await expect(page.getByText('1 Kind da, dazu 1 Gast.', { exact: true })).toBeVisible();

  await page.getByLabel(/Was habt ihr gemacht/).fill('Schnitzeljagd im Wald.');
  await page.getByRole('button', { name: 'Inhalt speichern' }).click();
  await expect(page.getByText('Der Inhalt ist gespeichert.').first()).toBeVisible();

  // Everything was saved, not only shown
  await page.reload();
  await expect(page.getByRole('button', { name: 'Anna Test' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByLabel(/Was habt ihr gemacht/)).toHaveValue('Schnitzeljagd im Wald.');

  await page.getByRole('button', { name: 'Verlauf & Statistik' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Restore the demo state for the following tests of this worker
  await page.getByRole('button', { name: 'Erfassen' }).click();
  await page.getByRole('button', { name: 'Testgast Schnuppern entfernen' }).click();
  await expect(
    page.getByText('Testgast Schnuppern ist nicht mehr eingetragen.').first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Anna Test' }).click();
  await expect(page.getByRole('button', { name: 'Anna Test' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.getByLabel(/Was habt ihr gemacht/).fill('');
  await page.getByRole('button', { name: 'Inhalt speichern' }).click();
  await expect(page.getByText('Der Inhalt ist gespeichert.').first()).toBeVisible();
});
