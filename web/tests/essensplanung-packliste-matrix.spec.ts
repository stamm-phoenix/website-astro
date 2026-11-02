import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen } from './essensplanung-helpers';
import { gerichteMitWerkzeugen, senden, werWaehlen } from './essensplanung-packliste-helpers';

test('something new is put on the list with who packs it; the choice stays for the next', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Packliste neu mit Person');
  await gerichteMitWerkzeugen(page);
  const liste = page.getByRole('list', { name: 'Packliste' });
  const zeile = (name: string) => liste.getByRole('listitem').filter({ hasText: name });
  const neu = page.getByLabel('Noch etwas einpacken');
  const wer = page.getByRole('button', { name: /^Wer packt\? / });

  // Name, Tab to who packs it, choose, Enter: on the list with them, back at the name
  await neu.fill('Gaskocher');
  await neu.press('Tab');
  await expect(wer).toBeFocused();
  await expect(wer).toHaveText('Niemand');
  await wer.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Wer packt Gaskocher ein?' });
  await dialog.getByRole('checkbox', { name: 'Kim Küche (du)' }).check();
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(wer).toHaveText('Kim Küche');
  await neu.press('Enter');
  await expect(
    page.getByText('Gaskocher steht auf der Packliste. Kim Küche packt').first()
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wer packt Gaskocher ein?' })).toHaveText(
    'Kim Küche'
  );
  await expect(neu).toBeFocused();
  await expect(neu).toHaveValue('');
  await expect(wer).toHaveText('Kim Küche');

  // The next one goes to the same person
  await neu.fill('Spülmittel');
  await neu.press('Enter');
  await expect(zeile('Spülmittel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wer packt Spülmittel ein?' })).toHaveText(
    'Kim Küche'
  );

  // Several at once: a member and another name; then nobody
  await neu.fill('Wasserkanister');
  await wer.click();
  await page
    .getByRole('dialog', { name: 'Wer packt Wasserkanister ein?' })
    .getByRole('textbox', { name: 'Anderer Name' })
    .fill('Rover');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(wer).toHaveText('Kim Küche, Rover');
  await neu.press('Enter');
  await expect(zeile('Wasserkanister')).toContainText('Kim Küche');
  await expect(zeile('Wasserkanister')).toContainText('Rover');
  await expect(zeile('Wasserkanister')).toContainText('0 von 2 gepackt');
  await wer.click();
  await page.getByRole('button', { name: 'Niemand', exact: true }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await neu.fill('Geschirrtücher');
  await neu.press('Enter');
  await expect(zeile('Geschirrtücher')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wer packt Geschirrtücher ein?' })).toHaveText(
    'Niemand zuständig'
  );
});

test('the matrix shows who packs what; cells are boxes and add persons with the keyboard', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Packliste Matrix');
  await senden(page, 'POST', '/mitglieder', {
    name: 'Alex Rover',
    email: 'alex@example.org',
    rolle: 'bearbeiten',
  });
  await gerichteMitWerkzeugen(page);
  await page.getByRole('button', { name: 'Matrix', exact: true }).click();
  const matrix = page.getByRole('grid', { name: 'Packliste als Matrix' });
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole('columnheader')).toHaveText([
    'Was',
    /Gepackt\s*0 von 3/,
    /Kim Küche \(du\)\s*nichts/,
    /Alex Rover\s*nichts/,
  ]);
  await expect(matrix.getByRole('rowheader', { name: /Großer Topf/ })).toContainText(
    'für Chili (1_2_1, 2_2_1) · Suppe (1_2_2)'
  );

  // A click in an empty cell adds the person; their cell is then their box
  await matrix.getByRole('button', { name: 'Alex Rover packt Großer Topf ein' }).click();
  await expect(page.getByText('Alex Rover packt Großer Topf ein.').first()).toBeVisible();
  const alexTopf = matrix.getByRole('checkbox', { name: 'Alex Rover hat Großer Topf gepackt' });
  await expect(alexTopf).not.toBeChecked();
  await expect(matrix.getByRole('columnheader', { name: /Alex Rover/ })).toContainText(
    '0 von 1 gepackt'
  );
  await matrix.getByRole('button', { name: 'Kim Küche packt Großer Topf ein' }).click();
  await expect(page.getByText('Kim Küche packt Großer Topf ein.').first()).toBeVisible();
  // With two persons, „Gepackt“ counts their boxes
  await expect(
    matrix.getByRole('button', { name: 'Wer packt Großer Topf ein? 0 von 2 gepackt' })
  ).toBeVisible();
  await alexTopf.check();
  await expect(page.getByText('Alex Rover hat Großer Topf eingepackt.').first()).toBeVisible();
  await expect(matrix.getByRole('columnheader', { name: /Alex Rover/ })).toContainText(
    '1 von 1 gepackt'
  );
  // Taking someone off goes through „Wer packt?“
  await werWaehlen(page, 'Großer Topf', { niemand: true });
  await expect(page.getByText('Für Großer Topf ist niemand mehr zuständig.').first()).toBeVisible();

  // Keyboard like a spreadsheet: one cell in the tab order, arrows move, Space and Enter act
  const box = matrix.getByRole('checkbox', { name: 'Großer Topf gepackt', exact: true });
  await box.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Großer Topf ist eingepackt.').first()).toBeVisible();
  await expect(box).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(
    matrix.getByRole('button', { name: 'Kim Küche packt Großer Topf ein' })
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    matrix.getByRole('button', { name: 'Kim Küche packt Kochlöffel ein' })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Kim Küche packt Kochlöffel ein.').first()).toBeVisible();
  const kimKoch = matrix.getByRole('checkbox', { name: 'Kim Küche hat Kochlöffel gepackt' });
  await expect(kimKoch).toBeFocused();
  await expect(matrix.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Kim Küche hat Kochlöffel eingepackt.').first()).toBeVisible();
  await expect(
    matrix.getByRole('checkbox', { name: 'Kochlöffel gepackt', exact: true })
  ).toBeChecked();
  await expect(matrix.getByRole('columnheader', { name: /Kim Küche/ })).toContainText(
    '1 von 1 gepackt'
  );
  await page.keyboard.press('Home');
  await expect(matrix.getByRole('button', { name: 'Wer packt Kochlöffel ein?' })).toBeFocused();

  // The filter works here too
  await page.getByRole('button', { name: 'Noch einpacken', exact: true }).click();
  await expect(matrix.getByRole('row')).toHaveCount(2);
  await matrix.getByRole('checkbox', { name: 'Pürierstab gepackt', exact: true }).check();
  await expect(page.getByText('Alles ist eingepackt.')).toBeVisible();
  await page.getByRole('button', { name: 'Alle', exact: true }).click();

  // The choice is remembered in this browser
  await page.reload();
  await page.getByRole('tab', { name: 'Packliste' }).click();
  await expect(page.getByRole('grid', { name: 'Packliste als Matrix' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);

  // The read-only link only shows it
  await page.setViewportSize({ width: 1536, height: 960 });
  const { lesen } = await senden<{ links: { lesen: string } }>(page, 'POST', '/links', {
    art: 'lesen',
    an: true,
  }).then((ansicht) => ansicht.links);
  const leser = await (await browser.newContext()).newPage();
  await leser.goto(`/essensplanung/planung#t=${lesen}`);
  await leser.getByRole('tab', { name: 'Packliste' }).click();
  await leser.getByRole('button', { name: 'Matrix', exact: true }).click();
  const lesend = leser.getByRole('grid', { name: 'Packliste als Matrix' });
  await expect(lesend.getByRole('row', { name: /Kochlöffel/ })).toContainText(
    'Kim Küche packt Kochlöffel ein, gepackt'
  );
  await expect(lesend.getByRole('button')).toHaveCount(0);
  await expect(lesend.getByRole('checkbox')).toHaveCount(0);
  await leser.context().close();
});

test('a member without access keeps what they pack, but gets nothing new', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Packliste Matrix ohne Zugang');
  const { ansicht } = await senden<{
    ansicht: { mitglieder: { id: number; name: string; etag: string }[] };
  }>(page, 'POST', '/mitglieder', {
    name: 'Alex Rover',
    email: 'alex@example.org',
    rolle: 'bearbeiten',
  });
  const { vorschauLink } = await senden<{ vorschauLink: string }>(page, 'POST', '/mitglieder', {
    name: 'Jo Jupfi',
    email: 'jo@example.org',
    rolle: 'bearbeiten',
  });
  const alex = ansicht.mitglieder.find((m) => m.name === 'Alex Rover')!;
  await senden(page, 'POST', '/packliste', { name: 'Gaskocher', mitglieder: [alex.id] });
  await senden(page, 'POST', '/packliste', { name: 'Spülmittel' });
  await senden(page, 'DELETE', `/mitglieder/${alex.id}`, undefined, alex.etag);

  // Jo does not manage the members: the view lacks Alex, the matrix names them from the row
  const jo = await (await browser.newContext()).newPage();
  await jo.goto(vorschauLink);
  await jo.getByRole('tab', { name: 'Packliste' }).click();
  await jo.getByRole('button', { name: 'Matrix', exact: true }).click();
  const matrix = jo.getByRole('grid', { name: 'Packliste als Matrix' });
  await expect(matrix.getByRole('columnheader', { name: /Alex Rover/ })).toContainText(
    'ohne Zugang'
  );
  const neu = matrix.getByRole('button', { name: 'Alex Rover packt Spülmittel ein' });
  await expect(neu).toHaveAttribute('aria-disabled', 'true');
  let anfragen = 0;
  await jo.route('**/api/essensplanung/planung/packliste/**', async (route) => {
    anfragen++;
    await route.continue();
  });
  // Playwright waits for aria-disabled elements; a click still reaches it
  await neu.click({ force: true });
  await expect(neu).toBeVisible();
  expect(anfragen).toBe(0);
  // Their own box still works; taking them off too, then the column goes
  await matrix.getByRole('checkbox', { name: 'Alex Rover hat Gaskocher gepackt' }).check();
  await expect(jo.getByText('Alex Rover hat Gaskocher eingepackt.').first()).toBeVisible();
  await jo.getByRole('button', { name: 'Wer packt Gaskocher ein?' }).first().click();
  const dialog = jo.getByRole('dialog', { name: 'Wer packt Gaskocher ein?' });
  await expect(dialog.getByRole('checkbox', { name: /Alex Rover/ })).toBeChecked();
  await dialog.getByRole('checkbox', { name: /Alex Rover/ }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: /Alex Rover/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(jo.getByText('Für Gaskocher ist niemand mehr zuständig.').first()).toBeVisible();
  await expect(matrix.getByRole('columnheader', { name: /Alex Rover/ })).toHaveCount(0);
  await jo.context().close();
});
