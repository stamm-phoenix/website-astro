import { test, expect } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';
import { gerichteMitWerkzeugen, senden } from './essensplanung-packliste-helpers';

test('a free name typed over a change of someone else asks before it saves', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Packliste Name zu zweit');
  await gerichteMitWerkzeugen(page);
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Packliste' }).click();

  // This page types a name, the other one chooses a member meanwhile
  await page.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' });
  await name.fill('Rover');
  await anderes.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Kim Küche' });
  await expect(anderes.getByText('Kim Küche packt Kochlöffel ein.').first()).toBeVisible();
  await page.getByText('Letzte Änderungen').click();
  await expect(page.getByText(/zuständig gemacht: Kochlöffel/)).toBeVisible({ timeout: 15_000 });

  // Saving names the new state and keeps the name; Enter again saves it on purpose
  await name.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'jetzt: Kim Küche' })).toBeVisible();
  await expect(name).toHaveValue('Rover');
  await name.press('Enter');
  await expect(page.getByText('Rover packt Kochlöffel ein.').first()).toBeVisible();
  await expect(anderes.getByLabel('Wer packt Kochlöffel ein?')).toHaveValue('text', {
    timeout: 15_000,
  });
  await anderes.context().close();
});

test('a save that ends late keeps a name typed on in the row shown anew', async ({ page }) => {
  await anlegen(page, 'E2E Packliste spät');
  await gerichteMitWerkzeugen(page);
  let freigeben = (): void => undefined;
  const gehalten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/packliste/werkzeug', async (route) => {
    await gehalten;
    await route.continue();
  });
  await page.getByLabel('Wer packt Pürierstab ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Pürierstab ein?' });
  await name.fill('Rover');
  await name.press('Enter');

  // The row goes and comes back while saving; the name is typed on there
  await page.getByRole('button', { name: 'Gepackt', exact: true }).click();
  await expect(name).toHaveCount(0);
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await expect(name).toHaveValue('Rover');
  await name.fill('Rover und Wö');
  freigeben();
  // Leaving the field while it was saved saves what was typed on, right after the first answer
  await expect(page.getByText('Rover und Wö packt Pürierstab ein.').first()).toBeVisible();
  await expect(page.getByLabel('Wer packt Pürierstab ein?')).toHaveValue('text');
  await expect(
    page.getByLabel('Wer packt Pürierstab ein?').locator('option[value="text"]')
  ).toHaveText('Rover und Wö');
});

test('a name typed on and left while it is saved is saved after it', async ({ page, browser }) => {
  await anlegen(page, 'E2E Packliste nachspeichern');
  await gerichteMitWerkzeugen(page);
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Packliste' }).click();
  let freigeben = (): void => undefined;
  const gehalten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/packliste/werkzeug', async (route) => {
    await gehalten;
    await route.continue();
  });

  // Enter saves „Rover“; meanwhile the name goes on and the field is left
  await page.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' });
  await name.fill('Rover');
  await name.press('Enter');
  await name.fill('Rover und Wö');
  await name.blur();
  freigeben();
  await expect(page.getByText('Rover und Wö packt Kochlöffel ein.').first()).toBeVisible();
  await expect(page.getByLabel('Wer packt Kochlöffel ein?')).toHaveValue('text');

  // The other one sees the name typed last
  await expect(
    anderes.getByLabel('Wer packt Kochlöffel ein?').locator('option[value="text"]')
  ).toHaveText('Rover und Wö', { timeout: 15_000 });
  await anderes.context().close();
});

test('a typed name is saved before its PDF; a failed save stops the PDF', async ({ page }) => {
  await anlegen(page, 'E2E Packliste PDF Name');
  await gerichteMitWerkzeugen(page);
  const werkzeug = '**/api/essensplanung/planung/packliste/werkzeug';

  // A slow save: the PDF waits for it and shows the new name
  await page.route(werkzeug, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Anderer Name …' });
  await page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' }).fill('Tante Erna');
  const pdf = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Packliste als PDF' }).click()
  );
  expect(pdf.text).toContain('Tante Erna');
  await expect(page.getByLabel('Wer packt Kochlöffel ein?')).toHaveValue('text');
  await page.unroute(werkzeug);

  // A save that fails: no PDF, and the page says why
  await page.route(werkzeug, (route) =>
    route.fulfill({ status: 500, json: { error: 'SERVER', message: 'Serverfehler' } })
  );
  let heruntergeladen = false;
  page.on('download', () => (heruntergeladen = true));
  await page.getByLabel('Wer packt Pürierstab ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Pürierstab ein?' });
  await name.fill('Onkel Otto');
  await page.getByRole('button', { name: 'Packliste als PDF' }).click();
  await expect(
    page.getByText(/Eine Änderung ist noch nicht gespeichert, das PDF wurde nicht erstellt/)
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Packliste als PDF' })).toBeEnabled();
  expect(heruntergeladen).toBe(false);
  await expect(name).toHaveValue('Onkel Otto');
});

test('a name typed at a tool no dish needs any more is named to copy', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Packliste Werkzeug weg');
  await gerichteMitWerkzeugen(page);
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());

  await page.getByLabel('Wer packt Pürierstab ein?').selectOption({ label: 'Anderer Name …' });
  await page.getByRole('textbox', { name: 'Wer packt Pürierstab ein?' }).fill('Tante Erna');

  // Someone else takes the soup, the only dish with the hand blender, out of the plan
  const ansicht = await senden(anderes, 'GET', '');
  const suppe = ansicht.gerichte.find((g) => g.name === 'Suppe')!;
  const einplanung = ansicht.tage
    .flatMap((tag) => tag.mahlzeiten.flatMap((m) => m.einplanungen))
    .find((e) => e.gerichtId === suppe.id)!;
  await senden(anderes, 'DELETE', `/einplanungen/${einplanung.id}`, undefined, einplanung.etag);
  await anderes.context().close();

  await expect(
    page
      .getByText('Zuständig für Pürierstab: „Tante Erna“ – das Werkzeug wird nicht mehr gebraucht.')
      .first()
  ).toBeVisible({ timeout: 15_000 });
  // Nothing was sent for the row that went
  await expect(page.getByText(/Kein eingeplantes Gericht braucht/)).toHaveCount(0);
  await expect(
    page
      .getByRole('list', { name: 'Packliste' })
      .getByRole('listitem')
      .filter({ hasText: 'Pürierstab' })
  ).toHaveCount(0);
});
