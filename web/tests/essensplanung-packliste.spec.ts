import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { pdfLaden } from './essensplanung-helpers';
import { planungVorbereiten } from './essensplanung-vorbereitung';
import { packlisteVorbereiten, senden, werWaehlen } from './essensplanung-packliste-helpers';

test('the packing list merges the tools of planned dishes; packing goes in the row', async ({
  page,
}) => {
  await packlisteVorbereiten(page, 'E2E Packliste');
  const liste = page.getByRole('list', { name: 'Packliste' });
  const zeile = (name: string) => liste.getByRole('listitem').filter({ hasText: name }).first();

  // Same names once, with the dishes and their planned meals; unplanned dishes bring nothing
  await expect(liste.getByRole('listitem')).toHaveCount(3);
  await expect(zeile('Großer Topf')).toContainText('für Chili (1_2_1, 2_2_1) · Suppe (1_2_2)');
  await expect(zeile('Pürierstab')).toContainText('für Suppe (1_2_2)');
  await expect(liste).not.toContainText('Waffeleisen');
  await expect(page.getByText('Häkchen werden sofort gespeichert.')).toBeVisible();

  // Packed with one tick, saved at once
  await page.getByRole('checkbox', { name: 'Großer Topf' }).check();
  await expect(page.getByText('Großer Topf ist eingepackt.').first()).toBeVisible();
  await expect(zeile('Großer Topf')).toContainText('gepackt');

  // Who packs it: a member, or a free name
  await werWaehlen(page, 'Kochlöffel', { mitglieder: ['Kim Küche (du)'] });
  await expect(page.getByText('Kim Küche packt Kochlöffel ein.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wer packt Kochlöffel ein?' })).toHaveText(
    'Kim Küche'
  );
  await werWaehlen(page, 'Pürierstab', { namen: ['Rover'] });
  await expect(page.getByText('Rover packt Pürierstab ein.').first()).toBeVisible();

  // Something of its own below the list, with Enter; a name on the list already is refused
  const neu = page.getByLabel('Noch etwas einpacken');
  await neu.fill('Gaskocher');
  await neu.press('Enter');
  await expect(zeile('Gaskocher')).toBeVisible();
  await expect(neu).toHaveValue('');
  await expect(neu).toBeFocused();
  await neu.fill('großer topf');
  await neu.press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Das steht schon auf der Packliste.' })
  ).toBeVisible();
  await expect(neu).toHaveValue('großer topf');
  await neu.fill('');

  // Filters: still to pack, and mine
  await page.getByRole('button', { name: 'Noch einpacken', exact: true }).click();
  await expect(liste.getByRole('listitem')).toHaveCount(3);
  await expect(liste).not.toContainText('Großer Topf');
  await page.getByRole('button', { name: 'Meine', exact: true }).click();
  await expect(liste.getByRole('listitem')).toHaveCount(1);
  await expect(liste).toContainText('Kochlöffel');
  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await expect(liste.getByRole('listitem')).toHaveCount(4);
  await expectNoHorizontalOverflow(page);

  const pdf = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Packliste als PDF' }).click()
  );
  expect(pdf.name).toBe('Packliste E2E Packliste.pdf');
  expect(pdf.text).toContain('Großer Topf');
  expect(pdf.text).toContain('Chili (1_2_1, 2_2_1) · Suppe (1_2_2)');
  expect(pdf.text).toContain('Gaskocher');
  expect(pdf.text).toContain('Rover');
  expect(pdf.text).not.toContain('Waffeleisen');

  // An entry of its own goes again, a tool stays
  await expect(page.getByRole('button', { name: 'Großer Topf entfernen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Gaskocher entfernen' }).click();
  await answerConfirm(page, 'Gaskocher von der Packliste nehmen?', 'Entfernen');
  await expect(liste.getByRole('listitem').filter({ hasText: 'Gaskocher' })).toHaveCount(0);
  await expect(liste.getByRole('listitem')).toHaveCount(3);
});

test('two people pack at once; the read-only link shows the list without changing it', async ({
  page,
  browser,
}) => {
  await packlisteVorbereiten(page, 'E2E Packliste zu zweit');
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Packliste' }).click();

  // This page does not hear of the other one's tick before it ticks the same tool
  await page.route('**/api/essensplanung/planung/stand*', (route) => route.abort());
  await anderes.getByRole('checkbox', { name: 'Großer Topf' }).check();
  await expect(anderes.getByText('Großer Topf ist eingepackt.').first()).toBeVisible();
  const box = page.getByRole('checkbox', { name: 'Großer Topf' });
  await box.check();
  await expect(page.getByText(/Jemand anderes hat das gerade geändert/).first()).toBeVisible();
  // The current state is shown
  await expect(box).toBeChecked();
  // Who packs it merges with the other's change: no conflict
  await werWaehlen(page, 'Großer Topf', { mitglieder: ['Kim Küche (du)'] });
  await expect(page.getByText('Kim Küche packt Großer Topf ein.').first()).toBeVisible();
  await page.unroute('**/api/essensplanung/planung/stand*');
  await expect(anderes.getByRole('button', { name: 'Wer packt Großer Topf ein?' })).toHaveText(
    'Kim Küche',
    { timeout: 15_000 }
  );
  await anderes.context().close();

  // The read-only link
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).nth(1).click();
  const links = page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/planung#t=' });
  await expect(links).toHaveCount(2);
  const lesen = (await links.last().textContent())!.trim();
  const leser = await (await browser.newContext()).newPage();
  await leser.goto(lesen);
  await leser.getByRole('tab', { name: 'Packliste' }).click();
  const topf = leser
    .getByRole('list', { name: 'Packliste' })
    .getByRole('listitem')
    .filter({ hasText: 'Großer Topf' });
  await expect(topf).toContainText('gepackt');
  await expect(topf).toContainText('Zuständig: Kim Küche');
  await expect(leser.getByRole('checkbox')).toHaveCount(0);
  await expect(leser.getByLabel('Noch etwas einpacken')).toHaveCount(0);
  await expect(leser.getByRole('button', { name: 'Packliste als PDF' })).toBeVisible();
  await leser.context().close();
});

test(
  'names that differ in signs have their own box; a choice not saved is asked about',
  { tag: '@mobile' },
  async ({ page }) => {
    await packlisteVorbereiten(page, 'E2E Packliste Zeichen', [
      ['Chili', ['Grill-Zange']],
      ['Suppe', ['Grill Zange']],
    ]);
    const liste = page.getByRole('list', { name: 'Packliste' });
    await expect(liste.getByRole('listitem')).toHaveCount(2);

    // A name and an open choice of persons survive the maintenance mode, which only locks adding
    const neu = page.getByLabel('Noch etwas einpacken');
    const wartung = async (an: boolean): Promise<void> => {
      await page.unroute('**/api/essensplanung/planung/stand?*');
      await page.route('**/api/essensplanung/planung/stand?*', async (route) => {
        const url = route
          .request()
          .url()
          .replace(/seit=[^&]*/, 'seit=0');
        const antwort = await route.fetch({ url });
        const json = await antwort.json();
        if (json.ansicht) json.ansicht.wartung = an;
        await route.fulfill({ response: antwort, json });
      });
    };
    await neu.fill('Gaskocher');
    await page.getByRole('button', { name: /^Wer packt\?/ }).click();
    const wer = page.getByRole('dialog', { name: 'Wer packt Gaskocher ein?' });
    const ich = wer.getByRole('group', { name: 'Mitglieder' }).getByRole('checkbox').first();
    await ich.check();
    await wer.getByLabel('Anderer Name').fill('Rover');
    await wartung(true);
    const aufDieListe = page.getByRole('button', { name: 'Auf die Packliste' });
    await expect(aufDieListe).toBeDisabled({ timeout: 15_000 });
    await expect(ich).toBeChecked();
    await expect(wer.getByLabel('Anderer Name')).toHaveValue('Rover');
    await wartung(false);
    await expect(aufDieListe).toBeEnabled({ timeout: 15_000 });
    await expect(neu).toHaveValue('Gaskocher');
    await page.unroute('**/api/essensplanung/planung/stand?*');
    await wer.getByLabel('Anderer Name').fill('');
    await ich.uncheck();
    await wer.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(wer).toBeHidden();
    await neu.fill('');

    // Box and name are one target of at least 44 px for a finger (compact with a mouse)
    await page.setViewportSize({ width: 390, height: 844 });
    const flaeche = await liste
      .locator('label', { has: page.getByRole('checkbox', { name: 'Grill Zange', exact: true }) })
      .boundingBox();
    const finger = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
    expect(flaeche!.height).toBeGreaterThanOrEqual(finger ? 44 : 28);
    expect(flaeche!.width).toBeGreaterThanOrEqual(finger ? 44 : 28);
    await expectNoHorizontalOverflow(page);

    // The label of the one row ticks its own box
    await liste.getByText('Grill Zange', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Grill Zange', exact: true })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Grill-Zange', exact: true })
    ).not.toBeChecked();
    await expect(page.getByText('Grill Zange ist eingepackt.').first()).toBeVisible();

    // A choice of who packs that is not saved yet: closing asks, leaving the page asks too
    await page.getByRole('button', { name: 'Wer packt Grill-Zange ein?' }).click();
    const dialog = page.getByRole('dialog', { name: 'Wer packt Grill-Zange ein?' });
    await dialog.getByRole('textbox', { name: 'Anderer Name' }).fill('Rover');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
    await expect(frage).toBeVisible();
    await frage.getByRole('button', { name: 'Weiter bearbeiten' }).click();
    // A typed name not added yet is saved with the choice
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Rover packt Grill-Zange ein.').first()).toBeVisible();
    await page.getByRole('link', { name: 'Impressum' }).first().click();
    await expect(page).toHaveURL(/impressum/, { timeout: 15_000 });
  }
);

test('an entry of its own that a dish planned later needs stays one row with its state', async ({
  page,
}) => {
  await planungVorbereiten(page, 'E2E Packliste eigen und Werkzeug', { tab: 'Packliste' });
  const neu = page.getByLabel('Noch etwas einpacken');
  await neu.fill('Gaskocher');
  await neu.press('Enter');
  await werWaehlen(page, 'Gaskocher', { namen: ['Rover'] });
  await expect(page.getByText('Rover packt Gaskocher ein.').first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Gaskocher' }).check();
  await expect(page.getByText('Gaskocher ist eingepackt.').first()).toBeVisible();

  // Then a dish that needs a gas stove is planned
  const { id: gerichtId } = await senden<{ id: number }>(page, 'POST', '/gerichte', {
    name: 'Grillen',
    personen: 10,
    werkzeuge: ['gaskocher'],
  });
  const ansicht = await senden(page, 'GET', '');
  await senden(page, 'POST', '/einplanungen', {
    mahlzeitId: ansicht.tage[0].mahlzeiten[1].id,
    gerichtId,
  });

  const liste = page.getByRole('list', { name: 'Packliste' });
  const zeile = liste.getByRole('listitem').filter({ hasText: /gaskocher/i });
  await expect(zeile).toContainText('für Grillen (1_2_1)', { timeout: 15_000 });
  await expect(zeile).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: 'Gaskocher' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Wer packt Gaskocher ein?' })).toHaveText('Rover');
  const pdf = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Packliste als PDF' }).click()
  );
  expect(pdf.text.match(/gaskocher/gi)).toHaveLength(1);

  // Removing the entry takes only its own state; the tool stays for the dish
  await page.getByRole('button', { name: 'Gaskocher entfernen' }).click();
  const frage = page.getByRole('dialog', { name: 'Eigene Angaben zu Gaskocher entfernen?' });
  await expect(frage).toContainText(
    'Deine Angaben zu Gaskocher (zuständig, gepackt) werden entfernt. Gaskocher bleibt auf der Packliste, weil Gerichte es brauchen.'
  );
  await frage.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await expect(
    page
      .getByText(
        'Eigene Angaben zu Gaskocher entfernt; es bleibt für die Gerichte auf der Packliste.'
      )
      .first()
  ).toBeVisible();
  await expect(zeile).toHaveCount(1);
  await expect(zeile).toContainText('für Grillen (1_2_1)');
  await expect(page.getByRole('checkbox', { name: 'gaskocher' })).not.toBeChecked();
});
