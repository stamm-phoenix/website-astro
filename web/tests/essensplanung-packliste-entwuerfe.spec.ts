import { test, expect, answerConfirm, expectNoHorizontalOverflow } from './fixtures';
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

test('an entry whose free name was just typed is removed right away', async ({ page }) => {
  await anlegen(page, 'E2E Packliste entfernen');
  await page.getByRole('tab', { name: 'Packliste' }).click();
  const neu = page.getByLabel('Noch etwas einpacken');
  await neu.fill('Gaskocher');
  await neu.press('Enter');
  const liste = page.getByRole('list', { name: 'Packliste' });
  await expect(liste.getByRole('listitem').filter({ hasText: 'Gaskocher' })).toHaveCount(1);

  // The name is saved on leaving the field with the tap on „Entfernen“, then the entry goes
  await page.getByLabel('Wer packt Gaskocher ein?').selectOption({ label: 'Anderer Name …' });
  await page.getByRole('textbox', { name: 'Wer packt Gaskocher ein?' }).fill('Rover');
  await page.getByRole('button', { name: 'Gaskocher entfernen' }).click();
  await answerConfirm(page, 'Gaskocher von der Packliste nehmen?', 'Entfernen');
  await expect(
    page.getByText('Gaskocher steht nicht mehr auf der Packliste.').first()
  ).toBeVisible();
  await expect(liste.getByRole('listitem').filter({ hasText: 'Gaskocher' })).toHaveCount(0);
});

test('a name typed and the tick tapped right after both save without a conflict', async ({
  page,
}) => {
  await anlegen(page, 'E2E Packliste Name und Haken');
  await gerichteMitWerkzeugen(page);
  const wer = page.getByLabel('Wer packt Kochlöffel ein?');
  const haken = page.getByRole('checkbox', { name: 'Kochlöffel' });

  // A tool nothing is stored for yet
  await wer.selectOption({ label: 'Anderer Name …' });
  await page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' }).fill('Rover');
  await haken.click();
  await expect(page.getByText('Kochlöffel ist eingepackt.').first()).toBeVisible();
  await expect(haken).toBeChecked();
  await expect(wer).toHaveValue('text');
  await expect(wer.locator('option[value="text"]')).toHaveText('Rover');

  // The same row, now stored
  await wer.selectOption({ label: 'Anderer Name …' });
  await page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' }).fill('Ben');
  await haken.click();
  await expect(page.getByText('Kochlöffel ist wieder offen.').first()).toBeVisible();
  await expect(haken).not.toBeChecked();
  await expect(wer.locator('option[value="text"]')).toHaveText('Ben');
  await expect(page.getByText(/Jemand anderes hat/)).toHaveCount(0);

  // Both are stored
  await page.reload();
  await page.getByRole('tab', { name: 'Packliste' }).click();
  await expect(page.getByRole('checkbox', { name: 'Kochlöffel' })).not.toBeChecked();
  await expect(
    page.getByLabel('Wer packt Kochlöffel ein?').locator('option[value="text"]')
  ).toHaveText('Ben');
});

test('a name in conflict is dropped with a button on the phone', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await anlegen(page, 'E2E Packliste verwerfen');
  await gerichteMitWerkzeugen(page);
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Packliste' }).click();

  await page.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' });
  await name.fill('Rover');
  await anderes.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Kim Küche' });
  await expect(anderes.getByText('Kim Küche packt Kochlöffel ein.').first()).toBeVisible();
  await anderes.context().close();
  // Waits for the poll without leaving the field (that would save and conflict on its own)
  await expect(page.getByText(/zuständig gemacht: Kochlöffel/)).toBeAttached({ timeout: 15_000 });
  await name.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'jetzt: Kim Küche' })).toBeVisible();

  // A button of at least 44 px for a finger takes the saved name; nothing is saved on the way
  const verwerfen = page.getByRole('button', { name: 'Name für Kochlöffel verwerfen' });
  const flaeche = (await verwerfen.boundingBox())!;
  const finger = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
  expect(flaeche.height).toBeGreaterThanOrEqual(finger ? 44 : 28);
  expect(flaeche.width).toBeGreaterThanOrEqual(finger ? 44 : 28);
  await verwerfen.click();
  await expect(name).toHaveCount(0);
  await expect(page.getByLabel('Wer packt Kochlöffel ein?')).toHaveValue(/^m:/);
  await expect(page.getByRole('alert').filter({ hasText: 'jetzt: Kim Küche' })).toHaveCount(0);
});

test('a tick saved while its name failed says the name is not saved', async ({ page }) => {
  await anlegen(page, 'E2E Packliste Haken ohne Name');
  await gerichteMitWerkzeugen(page);
  let anfragen = 0;
  await page.route('**/api/essensplanung/planung/packliste/werkzeug', (route) =>
    ++anfragen === 1
      ? route.fulfill({ status: 500, json: { error: 'SERVER', message: 'Serverfehler' } })
      : route.continue()
  );
  await page.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' });
  await name.fill('Rover');
  await page.getByRole('checkbox', { name: 'Kochlöffel' }).click();
  await expect(
    page.getByText(/Kochlöffel ist eingepackt\. Der Name „Rover“ ist aber noch nicht gespeichert/)
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Kochlöffel' })).toBeChecked();
  await expect(name).toHaveValue('Rover');
  await page.unroute('**/api/essensplanung/planung/packliste/werkzeug');

  // A long name of who packs it wraps on a phone, also when the list is only shown
  await name.fill('W'.repeat(100));
  await name.press('Enter');
  await expect(page.getByLabel('Wer packt Kochlöffel ein?')).toHaveValue('text');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/essensplanung/planung/stand?*', async (route) => {
    const url = route
      .request()
      .url()
      .replace(/seit=[^&]*/, 'seit=0');
    const antwort = await route.fetch({ url });
    const json = await antwort.json();
    if (json.ansicht) json.ansicht.wartung = true;
    await route.fulfill({ response: antwort, json });
  });
  await expect(page.getByText(`Zuständig: ${'W'.repeat(100)}`)).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalOverflow(page);
});

test('a name whose save runs cannot be dropped meanwhile', async ({ page, browser }) => {
  await anlegen(page, 'E2E Packliste nicht verwerfen');
  await gerichteMitWerkzeugen(page);
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Packliste' }).click();

  // A conflict: the other one chose a member while this page typed a name
  await page.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Anderer Name …' });
  const name = page.getByRole('textbox', { name: 'Wer packt Kochlöffel ein?' });
  await name.fill('Rover');
  await anderes.getByLabel('Wer packt Kochlöffel ein?').selectOption({ label: 'Kim Küche' });
  await expect(anderes.getByText('Kim Küche packt Kochlöffel ein.').first()).toBeVisible();
  await anderes.context().close();
  // Waits for the poll without leaving the field (that would save and conflict on its own)
  await expect(page.getByText(/zuständig gemacht: Kochlöffel/)).toBeAttached({ timeout: 15_000 });
  await name.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'jetzt: Kim Küche' })).toBeVisible();

  // Enter saves over it; while that runs, neither the button nor Escape takes the name back
  let freigeben = (): void => undefined;
  const gehalten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/packliste/werkzeug', async (route) => {
    await gehalten;
    await route.continue();
  });
  await name.press('Enter');
  await expect(page.getByRole('button', { name: 'Name für Kochlöffel verwerfen' })).toBeDisabled();
  await name.press('Escape');
  await expect(name).toHaveValue('Rover');
  freigeben();
  await expect(page.getByText('Rover packt Kochlöffel ein.').first()).toBeVisible();
  await expect(page.getByLabel('Wer packt Kochlöffel ein?').locator('option:checked')).toHaveText(
    'Rover'
  );
});
