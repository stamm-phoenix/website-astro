import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('a Planung is created, its meals are edited and others see the changes', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Lager');
  await expect(page.getByRole('heading', { name: /^Tag 1 ·/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const link = page.url();

  // A second window with the same link sees changes without reloading
  const zweites = await (await browser.newContext()).newPage();
  await zweites.goto(link);
  await expect(zweites.getByLabel('Name von 1_1')).toHaveValue('Frühstück');

  await page.getByLabel('Name von 1_1').fill('Brunch');
  await page.getByLabel('Name von 1_1').press('Enter');
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Brunch');
  await expect(zweites.getByLabel('Name von 1_1')).toHaveValue('Brunch', { timeout: 10_000 });

  // Moving the meal down changes the shown IDs
  await page.getByRole('button', { name: 'Brunch nach unten' }).click();
  await expect(page.getByLabel('Name von 1_2')).toHaveValue('Brunch');
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Mittagessen');

  await page.getByLabel('Neue Mahlzeit an Tag 2').fill('Abschlussgrillen');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).last().click();
  await expect(page.getByLabel('Name von 2_6')).toHaveValue('Abschlussgrillen');

  await page.getByRole('button', { name: 'Tag danach hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: /^Tag 3 ·/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tag 3 löschen' }).click();
  await answerConfirm(page, 'Tag 3 löschen?', 'Tag löschen');
  await expect(page.getByRole('heading', { name: /^Tag 3 ·/ })).toHaveCount(0);

  await page.getByText('Letzte Änderungen').click();
  await expect(
    page.getByText(/Kim Küche hat eine Mahlzeit geändert: Brunch/).first()
  ).toBeVisible();
  await zweites.context().close();
});

test('members are invited, join by link, read only, and lose access', async ({ page, browser }) => {
  await anlegen(page, 'E2E Mitglieder');
  await page.getByRole('tab', { name: 'Mitglieder' }).click();

  await page.getByLabel('Name', { exact: true }).fill('Ben Bezirk');
  await page.getByLabel('Mailadresse').fill('ben@example.org');
  await page.getByRole('button', { name: 'Einladen' }).click();
  const einladung = await page
    .getByRole('link', { name: /essensplanung\/planung#t=/ })
    .getAttribute('href');
  expect(einladung).toBeTruthy();

  const ben = await (await browser.newContext()).newPage();
  await ben.goto(einladung!);
  await expect(ben.getByText('Du planst mit')).toBeVisible();

  // Join link
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).first().click();
  await expect(page.getByText('Neuer Link erzeugt.').first()).toBeVisible();
  const beitritt = await page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/beitreten#b=' })
    .textContent();
  const cleo = await (await browser.newContext()).newPage();
  await cleo.goto(beitritt!.trim());
  await expect(cleo.getByRole('heading', { name: 'Bei „E2E Mitglieder“ mitplanen' })).toBeVisible();
  await cleo.getByLabel('Dein Name').fill('Cleo');
  await cleo.getByRole('button', { name: 'Beitreten' }).click();
  await expect(cleo.getByRole('heading', { name: 'E2E Mitglieder' })).toBeVisible();
  await expect(cleo.getByText('Du planst mit')).toBeVisible();

  // Read-only link: no inputs, no members
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).click();
  // The personal link and then the new read-only link
  await expect(
    page.locator('.copy-code .font-mono').filter({ hasText: '/essensplanung/planung#t=' })
  ).toHaveCount(2);
  const lesen = await page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/planung#t=' })
    .last()
    .textContent();
  const leser = await (await browser.newContext()).newPage();
  await leser.goto(lesen!.trim());
  await expect(leser.getByText('Nur ansehen')).toBeVisible();
  await expect(leser.getByText('Frühstück').first()).toBeVisible();
  await expect(leser.getByRole('textbox')).toHaveCount(0);
  await expect(leser.getByRole('tab', { name: 'Mitglieder' })).toHaveCount(0);

  // Removing Ben's access stops his link
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Ben Bezirk' })
    .getByRole('button', { name: 'Zugang entziehen' })
    .click();
  await answerConfirm(page, 'Ben Bezirk den Zugang entziehen?', 'Zugang entziehen');
  await expect(page.getByText('Ben Bezirk hat keinen Zugang mehr.').first()).toBeVisible();
  await ben.reload();
  await expect(ben.getByText(/Dieser Link gilt nicht/)).toBeVisible();

  for (const other of [ben, cleo, leser]) await other.context().close();
});

test('owners rename and delete; the Steuerung lists the Planungen', async ({ page }) => {
  await anlegen(page, 'E2E Löschen');
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.getByLabel('Name der Planung').fill('E2E Umbenannt');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Umbenannt' })).toBeVisible();

  await page.goto('/leitendenbereich/essensplanung-steuerung');
  await expect(page.getByRole('heading', { name: 'Alle Planungen' })).toBeVisible();
  await expect(page.getByText('E2E Umbenannt').first()).toBeVisible();

  await page.goBack();
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.getByRole('button', { name: 'Planung löschen' }).click();
  await answerConfirm(page, '„E2E Umbenannt“ löschen?', 'Endgültig löschen');
  await expect(page).toHaveURL(/\/essensplanung\/?$/);
});

test('an incomplete or old link explains how to get a new one', async ({ page }) => {
  await page.goto('/essensplanung/planung#t=abc');
  await expect(page.getByText(/Der Link ist unvollständig/)).toBeVisible();
  await page.goto(`/essensplanung/planung#t=${'x'.repeat(43)}`);
  await expect(page.getByText(/Dieser Link gilt nicht/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zur Essensplanung' })).toBeVisible();
});

test('input survives changes of others and saves in turn', async ({ page, browser }) => {
  // Two windows and five rounds of polling: about 25 s alone, more on a busy runner
  test.slow();
  await anlegen(page, 'E2E Entwurf');
  const link = page.url();
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(link);
  await expect(anderes.getByLabel('Name von 1_1')).toHaveValue('Frühstück');
  /** The next poll of the page that brings a new view; started before the other window changes. */
  const naechsterAbgleich = (): Promise<unknown> =>
    page.waitForResponse(
      async (response) =>
        response.url().includes('/planung/stand') &&
        'ansicht' in ((await response.json().catch(() => ({}))) as object),
      { timeout: 20_000 }
    );
  const abgeglichen = async (abgleich: Promise<unknown>): Promise<void> => {
    await page.bringToFront();
    await abgleich;
  };

  // Only looking at a field keeps nothing old: the name someone else set stays
  await page.getByLabel('Name von 1_1').focus();
  const abgleichZeit = naechsterAbgleich();
  await anderes.getByLabel('Name von 1_1').fill('Brunch');
  await anderes.getByLabel('Name von 1_1').press('Enter');
  await expect(anderes.getByLabel('Name von 1_1')).toHaveValue('Brunch');
  await abgeglichen(abgleichZeit);
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Frühstück');
  await page.getByLabel('Name von 1_1').blur();
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Brunch', { timeout: 10_000 });
  await page.waitForTimeout(1000);
  await anderes.reload();
  await expect(anderes.getByLabel('Name von 1_1')).toHaveValue('Brunch');

  // Both change the same name: the second keeps the input and is told
  await page.getByLabel('Name von 1_2').focus();
  await page.getByLabel('Name von 1_2').fill('Lunch');
  const abgleichName = naechsterAbgleich();
  await anderes.getByLabel('Name von 1_2').fill('Mittag');
  await anderes.getByLabel('Name von 1_2').press('Enter');
  await expect(anderes.getByLabel('Name von 1_2')).toHaveValue('Mittag');
  await abgeglichen(abgleichName);
  await page.getByLabel('Name von 1_2').blur();
  await expect(page.getByText(/Jemand anderes hat 1_2 gerade geändert/).first()).toBeVisible();
  await expect(page.getByLabel('Name von 1_2')).toHaveValue('Lunch');
  await page.getByLabel('Name von 1_2').focus();
  await page.getByLabel('Name von 1_2').blur();
  await anderes.bringToFront();
  await expect(anderes.getByLabel('Name von 1_2')).toHaveValue('Lunch', { timeout: 15_000 });

  // A new name in the settings stays while others change the plan
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.getByLabel('Name der Planung').fill('E2E Entwurf neu');
  const abgleichPlan = naechsterAbgleich();
  await anderes.getByLabel('Name von 1_3').fill('Kuchen');
  await anderes.getByLabel('Name von 1_3').press('Enter');
  await abgeglichen(abgleichPlan);
  await expect(page.getByLabel('Name der Planung')).toHaveValue('E2E Entwurf neu');
  // Switching areas keeps it too
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(page.getByLabel('Name von 1_3')).toHaveValue('Kuchen');
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await expect(page.getByLabel('Name der Planung')).toHaveValue('E2E Entwurf neu');

  // The own name typed in the members area stays while others change the plan
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByLabel('Dein Name in dieser Planung').fill('Kim Kocht');
  const abgleichMitglied = naechsterAbgleich();
  await anderes.getByLabel('Name von 1_3').fill('Waffeln');
  await anderes.getByLabel('Name von 1_3').press('Enter');
  await abgeglichen(abgleichMitglied);
  await expect(page.getByLabel('Dein Name in dieser Planung')).toHaveValue('Kim Kocht');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText('Dein Name ist gespeichert.').first()).toBeVisible();
  await expect(page.getByLabel('Dein Name in dieser Planung')).toHaveValue('Kim Kocht');

  // Two fields left while the first save is still running are both saved
  await page.getByRole('tab', { name: 'Plan' }).click();
  let erste = true;
  await page.route('**/api/essensplanung/planung/mahlzeiten/*', async (route) => {
    if (erste && route.request().method() === 'PATCH') {
      erste = false;
      await new Promise((done) => setTimeout(done, 1500));
    }
    await route.continue();
  });
  await page.getByLabel('Name von 1_4').fill('Grillen');
  await page.getByLabel('Name von 1_4').press('Enter');
  await page.getByLabel('Name von 1_5').fill('Lagerfeuer');
  await page.getByLabel('Name von 1_5').press('Enter');
  await anderes.bringToFront();
  await expect(anderes.getByLabel('Name von 1_4')).toHaveValue('Grillen', { timeout: 15_000 });
  await expect(anderes.getByLabel('Name von 1_5')).toHaveValue('Lagerfeuer', { timeout: 10_000 });
  await anderes.context().close();
});

test('saving the name keeps a setting someone else changed; long links fit', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Einstellungen');
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einstellungen' }).click();

  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.getByLabel('Name der Planung').fill('E2E Einstellungen neu');
  // Meanwhile the other owner lets everyone manage members
  await anderes.getByRole('checkbox', { name: /Alle dürfen Mitglieder verwalten/ }).check();
  await anderes.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(anderes.getByText('Einstellungen gespeichert.').first()).toBeVisible();

  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText('Einstellungen gespeichert.').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'E2E Einstellungen neu', level: 2 })
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: /Alle dürfen Mitglieder verwalten/ })
  ).toBeChecked();

  // The personal and shared links wrap instead of running off a phone screen
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).first().click();
  await expect(page.getByText('Neuer Link erzeugt.').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const kopieren = page.getByRole('button', { name: /^Persönlicher Link .* kopieren$/ });
  const box = (await kopieren.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await anderes.context().close();
});

test('unsaved meals ask before leaving; typing while saving the settings keeps the input', async ({
  page,
}) => {
  await anlegen(page, 'E2E Verlassen');

  // A meal whose save failed stays as a draft, and leaving the page asks first
  await page.route('**/api/essensplanung/planung/mahlzeiten/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { error: 'Kaputt' } })
      : route.continue()
  );
  await page.getByLabel('Name von 1_1').fill('Brunch');
  await page.getByLabel('Name von 1_1').press('Enter');
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Brunch');
  await page.getByRole('link', { name: 'Impressum' }).first().click();
  const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(frage).toBeVisible();
  await frage.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Brunch');
  await page.unroute('**/api/essensplanung/planung/mahlzeiten/*');

  // A name typed again while the first one is still saving stays as a draft
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.route('**/api/essensplanung/planung', async (route) => {
    if (route.request().method() === 'PATCH') await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByLabel('Name der Planung').fill('E2E Verlassen eins');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByLabel('Name der Planung').fill('E2E Verlassen zwei');
  await expect(page.getByText('Einstellungen gespeichert.').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E Verlassen eins', level: 2 })).toBeVisible();
  await expect(page.getByLabel('Name der Planung')).toHaveValue('E2E Verlassen zwei');
});

test('the skip link keeps the Planung on reload; a name typed while saving stays', async ({
  page,
}) => {
  await anlegen(page, 'E2E Sprung');
  await page.getByRole('link', { name: 'Zum Inhalt springen' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E Sprung', level: 2 })).toBeVisible();
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Frühstück');

  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.route('**/api/essensplanung/planung/ich', async (route) => {
    if (route.request().method() === 'PATCH') await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByLabel('Dein Name in dieser Planung').fill('Kim Kocht');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByLabel('Dein Name in dieser Planung').fill('Kim Backt');
  await expect(page.getByText('Dein Name ist gespeichert.').first()).toBeVisible();
  await expect(page.getByText('Kim Kocht (du)')).toBeVisible();
  await expect(page.getByLabel('Dein Name in dieser Planung')).toHaveValue('Kim Backt');
});

test('typing on while a meal or an invitation is saved keeps the next input', async ({ page }) => {
  await anlegen(page, 'E2E Weiter');

  // The name is saved while the time has focus; a second name afterwards is no conflict
  let ersteMahlzeit = true;
  await page.route('**/api/essensplanung/planung/mahlzeiten/*', async (route) => {
    if (ersteMahlzeit && route.request().method() === 'PATCH') {
      ersteMahlzeit = false;
      await new Promise((done) => setTimeout(done, 1500));
    }
    await route.continue();
  });
  const gespeichert = page.waitForResponse(
    (response) =>
      response.url().includes('/planung/mahlzeiten/') && response.request().method() === 'PATCH'
  );
  await page.getByLabel('Name von 1_1').fill('Brunch');
  await page.getByLabel('Uhrzeit von 1_1').focus();
  await gespeichert;
  await page.getByLabel('Name von 1_1').fill('Spätes Frühstück');
  await page.getByLabel('Name von 1_1').press('Enter');
  await page.waitForTimeout(1000);
  await expect(page.getByText(/Jemand anderes hat 1_1/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Name von 1_1')).toHaveValue('Spätes Frühstück');

  // The next person typed in while the invitation is sent stays in the form
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.route('**/api/essensplanung/planung/mitglieder', async (route) => {
    if (route.request().method() === 'POST') await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByLabel('Name', { exact: true }).fill('Ben Bezirk');
  await page.getByLabel('Mailadresse').fill('ben@example.org');
  await page.getByRole('button', { name: 'Einladen' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Cleo Chor');
  await page.getByLabel('Mailadresse').fill('cleo@example.org');
  await expect(page.getByText('ben@example.org')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Cleo Chor');
  await expect(page.getByLabel('Mailadresse')).toHaveValue('cleo@example.org');
});

test('a replaced link keeps the input; drafts ask before leaving; arrow keys switch areas', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Ersetzt');

  // Arrow keys move between the areas
  await page.getByRole('tab', { name: 'Plan' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Gerichte' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Teilnehmende' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Einkauf' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Packliste' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Mitglieder' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Mitglieder' })).toHaveAttribute(
    'aria-selected',
    'true'
  );

  // An invitation typed but not sent asks before leaving
  await page.getByLabel('Name', { exact: true }).fill('Ben Bezirk');
  await page.getByRole('link', { name: 'Impressum' }).first().click();
  const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(frage).toBeVisible();
  await frage.getByRole('button', { name: 'Weiter bearbeiten' }).click();

  // Ben's link is replaced while he types: his page stops saving but keeps the input
  await page.getByLabel('Mailadresse').fill('ben@example.org');
  await page.getByRole('button', { name: 'Einladen' }).click();
  const einladung = await page
    .getByRole('link', { name: /essensplanung\/planung#t=/ })
    .getAttribute('href');
  const ben = await (await browser.newContext()).newPage();
  await ben.goto(einladung!);
  await ben.getByLabel('Name von 1_1').fill('Brunch');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Ben Bezirk' })
    .getByRole('button', { name: 'Neuen Link schicken' })
    .click();
  await expect(page.getByText(/Vorschau-Umgebung|ist unterwegs/).first()).toBeVisible();
  await ben.bringToFront();
  await expect(ben.getByText(/Dieser Link gilt nicht mehr, wahrscheinlich/).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(ben.getByLabel('Name von 1_1')).toHaveValue('Brunch');

  // A meal typed while the one before is added stays
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.route('**/api/essensplanung/planung/mahlzeiten', async (route) => {
    if (route.request().method() === 'POST') await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.getByLabel('Neue Mahlzeit an Tag 1').fill('Grillen');
  await page.getByLabel('Neue Mahlzeit an Tag 1').press('Enter');
  await page.getByLabel('Neue Mahlzeit an Tag 1').fill('Nachtsnack');
  await expect(page.getByText('Grillen hinzugefügt.').first()).toBeVisible();
  await expect(page.getByLabel('Neue Mahlzeit an Tag 1')).toHaveValue('Nachtsnack');
  await ben.context().close();
});

test('a failing sync is shown; a failed day move stays and asks before leaving', async ({
  page,
}) => {
  await anlegen(page, 'E2E Abgleich');

  // Server errors of the sync show a hint until it works again
  await page.route('**/api/essensplanung/planung/stand*', (route) =>
    route.fulfill({ status: 500, json: { error: 'Kaputt' } })
  );
  await expect(page.getByText('Der Abgleich klappt gerade nicht.', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await page.unroute('**/api/essensplanung/planung/stand*');
  await expect(page.getByText('Der Abgleich klappt gerade nicht.', { exact: false })).toHaveCount(
    0,
    { timeout: 40_000 }
  );

  // A day move that fails keeps the picked date, and leaving asks first
  await page.route('**/api/essensplanung/planung/tage/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { error: 'Kaputt' } })
      : route.continue()
  );
  await page.getByLabel('Datum von Tag 1').fill('2027-07-30');
  await expect(page.getByLabel('Datum von Tag 1')).toHaveValue('2027-07-30');
  await page.getByRole('link', { name: 'Impressum' }).first().click();
  const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(frage).toBeVisible();
  await frage.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(page.getByLabel('Datum von Tag 1')).toHaveValue('2027-07-30');
});

test('a meal deleted by someone else shows the unsaved input', async ({ page, browser }) => {
  await anlegen(page, 'E2E Gelöscht');
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await page.getByLabel('Name von 1_2').fill('Brunch für alle');
  await anderes.getByRole('button', { name: 'Mittagessen löschen' }).first().click();
  await answerConfirm(anderes, '1_2 Mittagessen löschen?', 'Mahlzeit löschen');
  await expect(anderes.getByText('Mittagessen gelöscht.').first()).toBeVisible();
  await page.bringToFront();
  await expect(
    page
      .getByText('1_2 wurde gerade gelöscht. Deine Eingabe „Brunch für alle“', { exact: false })
      .first()
  ).toBeVisible({ timeout: 15_000 });
  await anderes.context().close();
});
