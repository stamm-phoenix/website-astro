import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen } from './essensplanung-helpers';
import { gerichteMitWerkzeugen, senden } from './essensplanung-packliste-helpers';

test('something new is put on the list with who packs it; the choice stays for the next', async ({
  page,
}) => {
  await anlegen(page, 'E2E Packliste neu mit Person');
  await gerichteMitWerkzeugen(page);
  const liste = page.getByRole('list', { name: 'Packliste' });
  const zeile = (name: string) => liste.getByRole('listitem').filter({ hasText: name });
  const neu = page.getByLabel('Noch etwas einpacken');
  const wer = page.getByLabel('Wer packt?', { exact: true });

  // Name, Tab to who packs it, Enter: on the list with them, back at the name
  await neu.fill('Gaskocher');
  await neu.press('Tab');
  await expect(wer).toBeFocused();
  await wer.selectOption({ label: 'Kim Küche (du)' });
  await wer.press('Enter');
  await expect(
    page.getByText('Gaskocher steht auf der Packliste. Kim Küche packt').first()
  ).toBeVisible();
  await expect(page.getByLabel('Wer packt Gaskocher ein?')).toHaveValue(/^m:/);
  await expect(neu).toBeFocused();
  await expect(neu).toHaveValue('');
  await expect(wer).toHaveValue(/^m:/);

  // The next one goes to the same person
  await neu.fill('Spülmittel');
  await neu.press('Enter');
  await expect(zeile('Spülmittel')).toBeVisible();
  await expect(page.getByLabel('Wer packt Spülmittel ein?')).toHaveValue(/^m:/);

  // Another name with its own field; nobody
  await wer.selectOption({ label: 'Anderer Name …' });
  const anderer = page.getByLabel('Anderer Name, wer packt');
  await expect(anderer).toBeFocused();
  await anderer.fill('Rover');
  await neu.fill('Wasserkanister');
  await anderer.press('Enter');
  await expect(zeile('Wasserkanister')).toBeVisible();
  await expect(page.getByLabel('Wer packt Wasserkanister ein?')).toHaveValue('text');
  await expect(zeile('Wasserkanister').getByRole('combobox')).toContainText('Rover');
  await wer.selectOption({ label: 'Niemand' });
  await neu.fill('Geschirrtücher');
  await neu.press('Enter');
  await expect(zeile('Geschirrtücher')).toBeVisible();
  await expect(page.getByLabel('Wer packt Geschirrtücher ein?')).toHaveValue('');
});

test('the matrix shows who packs what; cells assign and pack with the keyboard', async ({
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
    /Niemand\s*0 von 3 gepackt/,
  ]);
  await expect(matrix.getByRole('rowheader', { name: /Großer Topf/ })).toContainText(
    'für Chili (1_2_1, 2_2_1) · Suppe (1_2_2)'
  );

  // A click assigns; the same cell again takes it back
  const alexTopf = matrix.getByRole('button', { name: 'Alex Rover packt Großer Topf ein' });
  await alexTopf.click();
  await expect(page.getByText('Alex Rover packt Großer Topf ein.').first()).toBeVisible();
  await expect(alexTopf).toHaveAttribute('aria-pressed', 'true');
  await expect(matrix.getByRole('columnheader', { name: /Alex Rover/ })).toContainText(
    '0 von 1 gepackt'
  );
  await alexTopf.click();
  await expect(page.getByText('Für Großer Topf ist niemand mehr zuständig.').first()).toBeVisible();
  await expect(
    matrix.getByRole('button', { name: 'Niemand packt Großer Topf ein' })
  ).toHaveAttribute('aria-pressed', 'true');

  // Keyboard like a spreadsheet: one cell in the tab order, arrows move, Space and Enter act
  const box = matrix.getByRole('checkbox', { name: 'Großer Topf gepackt' });
  await box.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Großer Topf ist eingepackt.').first()).toBeVisible();
  await expect(box).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(
    matrix.getByRole('button', { name: 'Kim Küche packt Großer Topf ein' })
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const kimKoch = matrix.getByRole('button', { name: 'Kim Küche packt Kochlöffel ein' });
  await expect(kimKoch).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Kim Küche packt Kochlöffel ein.').first()).toBeVisible();
  await expect(kimKoch).toHaveAttribute('aria-pressed', 'true');
  await expect(kimKoch).toBeFocused();
  await expect(matrix.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Home');
  await expect(matrix.getByRole('checkbox', { name: 'Kochlöffel gepackt' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Kochlöffel ist eingepackt.').first()).toBeVisible();
  await expect(matrix.getByRole('columnheader', { name: /Kim Küche/ })).toContainText(
    '1 von 1 gepackt'
  );

  // The filter works here too; the focus stays in the matrix when its row goes
  await page.getByRole('button', { name: 'Noch einpacken', exact: true }).click();
  await expect(matrix.getByRole('row')).toHaveCount(2);
  await matrix.getByRole('checkbox', { name: 'Pürierstab gepackt' }).check();
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
    'Kim Küche packt Kochlöffel ein'
  );
  await expect(lesend.getByRole('button')).toHaveCount(0);
  await expect(lesend.getByRole('checkbox')).toHaveCount(0);
  await leser.context().close();
});

test('a choice in the matrix waits for the name still saving from the list', async ({ page }) => {
  await anlegen(page, 'E2E Packliste Matrix wartet');
  await gerichteMitWerkzeugen(page);
  // The name's save answers late
  const gesendet: (string | null)[] = [];
  await page.route('**/api/essensplanung/planung/packliste/werkzeug', async (route) => {
    const body = route.request().postDataJSON() as { etag: string | null };
    gesendet.push(body.etag);
    if (gesendet.length === 1) await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByLabel('Wer packt Pürierstab ein?').selectOption({ label: 'Anderer Name …' });
  await page.getByRole('textbox', { name: 'Wer packt Pürierstab ein?' }).fill('Rover');
  // Leaving the field for the matrix saves the name; the choice there comes before its answer
  await page.getByRole('button', { name: 'Matrix', exact: true }).click();
  const matrix = page.getByRole('grid', { name: 'Packliste als Matrix' });
  const kim = matrix.getByRole('button', { name: 'Kim Küche packt Pürierstab ein' });
  await kim.click();
  await expect(page.getByText('Kim Küche packt Pürierstab ein.').first()).toBeVisible();
  await expect(kim).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Jemand anderes hat/)).toHaveCount(0);
  // The choice went on the version the name's save brought
  expect(gesendet).toHaveLength(2);
  expect(gesendet[0]).toBeNull();
  expect(gesendet[1]).not.toBeNull();
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await expect(page.getByLabel('Wer packt Pürierstab ein?')).toHaveValue(/^m:/);
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
  await senden(page, 'POST', '/packliste', { name: 'Gaskocher', zustaendigId: alex.id });
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
  await expect(neu).toHaveAttribute('aria-pressed', 'false');
  expect(anfragen).toBe(0);
  // Taking them off what they pack works; then the column goes
  const alt = matrix.getByRole('button', { name: 'Alex Rover packt Gaskocher ein' });
  await expect(alt).toHaveAttribute('aria-pressed', 'true');
  await alt.click();
  await expect(jo.getByText('Für Gaskocher ist niemand mehr zuständig.').first()).toBeVisible();
  await expect(matrix.getByRole('columnheader', { name: /Alex Rover/ })).toHaveCount(0);
  await jo.context().close();
});
