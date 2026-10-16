import { readFile } from 'node:fs/promises';
import {
  test,
  expect,
  expectNoHorizontalOverflow,
  expectWithinWindowWidth,
  answerConfirm,
} from './fixtures';

test('the Abrechnung of an Aktion shows the balance and recalculates the KJR grant', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/abrechnung');
  await page.getByRole('link', { name: /Sommerlager 2026 Oberjoch/ }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/abrechnung\/evt_Sola26$/);

  await expect(page.getByRole('heading', { name: 'Einnahmen und Ausgaben' })).toBeVisible();
  await expect(page.getByTestId('ergebnis')).toHaveText(/-3\.150,33\s€/);
  await expect(page.getByText('3 ab 27', { exact: true })).toBeVisible();
  await expect(page.getByTestId('zuschuss-formel')).toContainText('× 10 Tage');

  const errechnet = await page.getByTestId('zuschuss-errechnet').textContent();
  await page.getByRole('checkbox', { name: /Zusatztag/ }).check();
  await expect(page.getByTestId('zuschuss-formel')).toContainText('× 11 Tage');
  await expect(page.getByTestId('zuschuss-errechnet')).not.toHaveText(errechnet ?? '');
  await expectNoHorizontalOverflow(page);

  // Teilnehmende from outside the Landkreis are not subsidised
  await expect(
    page.getByText(/2 Teilnehmende wohnen laut Postleitzahl nicht im Landkreis Rosenheim/)
  ).toBeVisible();

  // The KJR's Teilnahmeliste, filled with the registrations
  await page.getByLabel('Veranstaltungsort').fill('Jugendzeltplatz Oberjoch');
  await page.getByLabel('Postleitzahl des Ortes').fill('87541');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Teilnahmeliste herunterladen' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('KJR-Teilnahmeliste Sommerlager 2026 Oberjoch.xlsx');
  const file = await readFile(await download.path());
  expect(file.subarray(0, 2).toString()).toBe('PK');

  // Surplus: no grant
  await page.goto('/leitendenbereich/abrechnung/evt_WoeHerbst');
  await expect(page.getByTestId('zuschuss-beantragbar')).toContainText(
    'nicht beantragbar – kein Defizit'
  );
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).not.toBeChecked();

  // No Kostenstelle with the title of the Aktion: pick one; old links still work
  await page.goto('/leitendenbereich/abrechnung?aktion=evt_HikeMangfall');
  await expect(page).toHaveURL(/\/leitendenbereich\/abrechnung\/evt_HikeMangfall$/);
  await expect(page.getByRole('heading', { name: 'Kostenstelle nicht gefunden' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Kostenstelle', exact: true })
    .selectOption({ label: 'Hike 2026' });
  await expect(page).toHaveURL(/kostenstelle=cun_Hike/);
  await expect(page.getByTestId('ergebnis')).toHaveText(/-41,60\s€/);

  await page.reload();
  await expect(page.getByTestId('ergebnis')).toHaveText(/-41,60\s€/);
});

test('a popup stays clickable when the footer scrolls under it', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await page.getByRole('tab', { name: /Teilnehmende/ }).click();
  await page.getByLabel('Nachname').fill('Unten');
  await page.getByLabel('Vorname').fill('Ulla');
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  const button = page.getByRole('button', { name: 'In der Liste zeigen', exact: true });
  await expect(button).toBeVisible();
  // The footer under the fixed popup must not take its clicks. The staff footer is short, so
  // it is stretched here to reach the popup at the bottom of the window.
  await page.addStyleTag({ content: 'body > footer { min-height: 50vh; }' });
  await page.mouse.wheel(0, 10_000);
  const box = (await button.boundingBox())!;
  await expect
    .poll(() => page.evaluate(() => document.querySelector('footer')!.getBoundingClientRect().top))
    .toBeLessThan(box.y);
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.textContent?.trim(),
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(hit).toBe('In der Liste zeigen');
});

test('Teilnehmende can be left out or added and both lists export as PDF', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const formel = page.getByTestId('zuschuss-formel');
  await expect(formel).toBeVisible();
  const before = Number(/× (\d+)\s+Person/.exec((await formel.textContent()) ?? '')?.[1]);
  expect(before).toBeGreaterThan(0);

  // Leave out a Betreuerin and add a Teilnehmer from the Landkreis
  await page.getByRole('tab', { name: /Teilnehmende/ }).click();
  await expect(page).toHaveURL(/tab=teilnehmende/);
  await page.getByRole('checkbox', { name: 'Kim Leitung abrechnen' }).uncheck();
  await page.getByLabel('Nachname').fill('Nachtrag');
  await page.getByLabel('Vorname').fill('Nora');
  await page.getByLabel('Alter', { exact: true }).fill('12');
  await page.getByLabel('PLZ', { exact: true }).fill('83620');
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('Nora Nachtrag wurde nachgetragen')).toBeVisible();
  await expect(page.getByLabel('Nachname')).toBeFocused();
  await page.getByRole('button', { name: 'In der Liste zeigen', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Nora Nachtrag abrechnen' })).toBeFocused();
  await expect(page.getByRole('row', { name: /Nachtrag, Nora/ })).toContainText('nachgetragen');
  await expectNoHorizontalOverflow(page);

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als PDF herunterladen' }).click();
  const teilnehmendePdf = await pdfDownload;
  expect(teilnehmendePdf.suggestedFilename()).toBe('Teilnehmende Sommerlager 2026 Oberjoch.pdf');
  const pdf = await readFile(await teilnehmendePdf.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  // The overview counts the changed list
  await page.getByRole('tab', { name: 'Übersicht' }).click();
  // One Betreuerin less, one Teilnehmer from the Landkreis more
  await expect(formel).toContainText(new RegExp(`× ${before}\\s+Personen`));
  await expect(page.getByText('Angepasste Liste: 1 ausgeschlossen, 1 nachgetragen.')).toBeVisible();

  // Einzelnachweise filtered by Kategorie
  await page.getByRole('tab', { name: /Einzelnachweise/ }).click();
  await page.getByLabel('Kategorie').selectOption('Verpflegung');
  await expect(page.getByText('3 von 12 Buchungen')).toBeVisible();
  await expect(page.getByTestId('nachweise-saldo')).toHaveText(/-2\.485,42\s€/);
  await expectNoHorizontalOverflow(page);

  const nachweisDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Liste als PDF' }).click();
  expect((await nachweisDownload).suggestedFilename()).toBe(
    'Einzelnachweise Sommerlager 2026 Oberjoch Verpflegung.pdf'
  );
});

test('younger Leitende can be entered as Betreuer*innen, from 27 on always', async ({ page }) => {
  // Nobody on the Hike is 27 or older
  await page.goto('/leitendenbereich/abrechnung/evt_HikeMangfall?kostenstelle=cun_Hike');
  const hinweis = page.getByText(/Auf der Aktion ist niemand 27 Jahre oder älter/);
  await expect(hinweis).toBeVisible();
  await page.getByRole('button', { name: 'Betreuer*innen eintragen' }).click();
  await expect(page).toHaveURL(/tab=teilnehmende/);

  // Betreuer*innen are listed above the Teilnehmende; a changed role moves the person
  const betreuer = page.getByTestId('tn-gruppe-betreuer');
  const teilnehmende = page.getByTestId('tn-gruppe-teilnehmende');
  await expect(betreuer).toContainText('Betreuer*innen (0)');
  const rolle = teilnehmende.getByRole('combobox', { name: /^Rolle / }).first();
  const name = ((await rolle.getAttribute('aria-label')) ?? '').replace(/^Rolle /, '');
  await rolle.selectOption('Betreuer*in');
  await expect(betreuer.getByRole('combobox', { name: `Rolle ${name}` })).toBeVisible();
  await expect(betreuer).toContainText('Betreuer*innen (1)');
  await expect(page.getByTestId('tn-zusammenfassung')).toContainText('1 Betreuer*innen (0 ab 27)');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: 'Übersicht' }).click();
  await expect(hinweis).toHaveCount(0);
  await expect(page.getByText('0 ab 27, 1 jünger eingetragen')).toBeVisible();

  // Zurücksetzen brings back the list from CampFlow
  await page.getByRole('tab', { name: /Teilnehmende/ }).click();
  await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await answerConfirm(page, 'Teilnehmendenliste zurücksetzen?', 'Zurücksetzen');
  await expect(teilnehmende.getByRole('combobox', { name: `Rolle ${name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zurücksetzen', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Übersicht' }).click();
  await expect(hinweis).toBeVisible();

  // From 27 on the role is fixed
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=teilnehmende');
  await expect(page.getByRole('row', { name: /Leitung, Kim/ })).toContainText('Betreuer*in');
  await expect(page.getByRole('combobox', { name: 'Rolle Kim Leitung' })).toHaveCount(0);
});

test('on a phone every tab of the Abrechnung is on screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Narrow screens only');
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  for (const tab of await tabs.all()) await expectWithinWindowWidth(page, tab);
  for (const tab of await tabs.all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('tab', { name: 'Leihgebühren' }).click();
  await expect(page.getByRole('tab', { name: 'Leihgebühren' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expectNoHorizontalOverflow(page);
});

test('on a phone the role and the grant of a participant are visible without scrolling sideways', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Narrow screens only');
  await page.goto(
    '/leitendenbereich/abrechnung/evt_HikeMangfall?kostenstelle=cun_Hike&tab=teilnehmende'
  );
  const teilnehmende = page.getByTestId('tn-gruppe-teilnehmende');
  const rolle = teilnehmende.getByRole('combobox', { name: /^Rolle / }).first();
  const name = ((await rolle.getAttribute('aria-label')) ?? '').replace(/^Rolle /, '');
  const row = page.locator('tr', {
    has: page.getByRole('combobox', { name: `Rolle ${name}`, exact: true }),
  });
  await expectWithinWindowWidth(page, rolle);
  await expectWithinWindowWidth(page, row.getByLabel(`PLZ ${name}`));
  const zuschuss = row.getByTestId('zuschuss-grund');
  await expect(zuschuss).toHaveText(/^(ja|nein)/);
  await expect(zuschuss.locator('..')).toHaveText(/^Bezuschusst\s*(ja|nein)/);
  await expectWithinWindowWidth(page, zuschuss);
  expect(
    (await row.getByRole('checkbox').locator('..').boundingBox())!.height
  ).toBeGreaterThanOrEqual(44);

  // The controls still work in the stacked layout
  await rolle.selectOption('Betreuer*in');
  await expect(
    page.getByTestId('tn-gruppe-betreuer').getByRole('combobox', { name: `Rolle ${name}` })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the Übersicht lists the Auslagen per person', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const auslagen = page.getByTestId('auslagen');
  await expect(auslagen.getByRole('row', { name: /Alex Beispiel/ })).toContainText(
    /3\s*3\.883,22\s€/
  );
  await expect(auslagen.getByRole('row', { name: /Kim Muster/ })).toContainText(/3\s*1\.409,90\s€/);
  await expect(auslagen.getByRole('row', { name: /Summe/ })).toContainText(/5\.293,12\s€/);
  await expectNoHorizontalOverflow(page);
});

test('the PLZ of a person can be changed, which changes whether the KJR subsidises them', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=teilnehmende');
  const gast = page.getByRole('row', { name: /München, Gast/ });
  // The Wohnort from CampFlow and why the KJR does not subsidise her
  await expect(gast).toContainText('München');
  await expect(gast.getByTestId('zuschuss-grund')).toHaveText('nein (nicht LK Rosenheim)');
  await expect(
    page.getByRole('row', { name: /Leitung, Kim/ }).getByTestId('zuschuss-grund')
  ).toHaveText('ja (Betreuer*in)');

  const plz = page.getByLabel('PLZ Gast München');
  await expect(plz).toHaveValue('80331');
  await plz.fill('836');
  await expect(plz).toHaveAttribute('aria-invalid', 'true');
  await expect(gast.getByTestId('zuschuss-grund')).toHaveText('nein (nicht LK Rosenheim)');
  await plz.fill('83620');
  await expect(gast.getByTestId('zuschuss-grund')).toHaveText('ja (LK Rosenheim)');
  // The Wohnort follows the changed Postleitzahl
  await expect(gast).toContainText('Feldkirchen-Westerham');
  await expectNoHorizontalOverflow(page);

  // The logged-in user is marked
  await page.getByLabel('Nachname').fill('Leitung');
  await page.getByLabel('Vorname').fill('Demo');
  await page.getByLabel('Alter', { exact: true }).fill('30');
  await page.getByLabel('PLZ', { exact: true }).fill('83043');
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  const ich = page.getByRole('row', { name: /Leitung, Demo/ });
  await expect(ich).toContainText('(ich)');
  // The Wohnort of an added person comes from the Postleitzahl
  await expect(ich).toContainText('Bad Aibling');

  // Zurücksetzen restores the PLZ from CampFlow
  await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await answerConfirm(page, 'Teilnehmendenliste zurücksetzen?', 'Zurücksetzen');
  await expect(plz).toHaveValue('80331');
  await expect(gast.getByTestId('zuschuss-grund')).toHaveText('nein (nicht LK Rosenheim)');
  await expect(gast).toContainText('München');

  // The KJR's Teilnahmeliste is one click away, with the days of the Aktion next to the times
  await page.getByRole('button', { name: 'Zur KJR-Teilnahmeliste' }).click();
  await expect(page).not.toHaveURL(/tab=/);
  await expect(page.getByRole('heading', { name: 'Teilnahmeliste für den KJR' })).toBeInViewport();
  await expect(page.getByTestId('kjr-beginn-datum')).toHaveText('am 01.08.2026, Uhrzeit');
  await expect(page.getByTestId('kjr-ende-datum')).toHaveText('am 11.08.2026, Uhrzeit');
});

test('without the table of Postleitzahlen the Teilnehmende PDF is not created', async ({
  page,
}) => {
  await page.route('**/abrechnung/plz-orte.json', (route) => route.fulfill({ status: 503 }));
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=teilnehmende');
  await page.getByLabel('PLZ Gast München').fill('83620');
  await expect(
    page.getByText(/Die Orte zu geänderten und nachgetragenen Postleitzahlen/)
  ).toBeVisible();

  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.getByRole('button', { name: 'Als PDF herunterladen' }).click();
  await expect(page.getByText(/deshalb wurde kein PDF erstellt/)).toBeVisible();
  expect(downloaded).toBe(false);
});
