import { resetAccountingInputs } from './abrechnung-helpers';
import { test, expect, answerConfirm, expectNoHorizontalOverflow } from './fixtures';

const URL = '/leitendenbereich/abrechnung/evt_Sola26?tab=kurzbeschreibung';

test.beforeEach(async ({ page }) => {
  await resetAccountingInputs(page);
});

test('the Zeitplan starts with the days of the Aktion and blocks are added, moved and saved', async ({
  page,
}) => {
  await page.goto(URL);
  await expect(page.getByRole('tab', { name: 'Kurzbeschreibung' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  const samstag = page.getByRole('region', { name: 'Samstag, 01.08.2026' });
  const sonntag = page.getByRole('region', { name: 'Sonntag, 02.08.2026' });
  await expect(samstag).toBeVisible();
  await expect(page.getByRole('region', { name: 'Dienstag, 11.08.2026' })).toBeVisible();

  await page.getByLabel('Zielsetzung').fill('Wir stärken die Gemeinschaft im Stamm.');

  // A new block starts where the one before ended; Enter in its text adds the next one
  await samstag.getByRole('button', { name: 'Block hinzufügen' }).click();
  await samstag.getByLabel('Beginn von „neuer Block“').fill('08:00');
  await samstag.getByLabel('Ende von „neuer Block“').fill('09:00');
  await samstag.getByLabel('Programmpunkt').fill('Frühstück');
  await samstag.getByLabel('Programmpunkt').press('Enter');
  await expect(samstag.getByLabel('Beginn von „neuer Block“')).toHaveValue('09:00');
  await expect(samstag.getByLabel('Ende von „neuer Block“')).toBeFocused();
  await samstag.getByLabel('Programmpunkt').nth(1).fill('Geländespiel');

  // Several lines at once, then the same day's plan for Sunday
  await samstag.getByRole('button', { name: 'Mehrere Zeilen einfügen' }).click();
  await samstag
    .getByLabel('Mehrere Blöcke, einer pro Zeile')
    .fill('7:30-8 Uhr Morgenrunde\n20 Uhr Lagerfeuer');
  // Lines not taken over yet survive a look at another tab
  await page.getByRole('tab', { name: /Übersicht/ }).click();
  await page.getByRole('tab', { name: 'Kurzbeschreibung' }).click();
  await expect(samstag.getByLabel('Mehrere Blöcke, einer pro Zeile')).toHaveValue(
    '7:30-8 Uhr Morgenrunde\n20 Uhr Lagerfeuer'
  );
  await samstag.getByRole('button', { name: 'Blöcke übernehmen' }).click();
  await expect(page.getByText('2 Blöcke übernommen.').first()).toBeVisible();
  await samstag.getByRole('button', { name: 'Nach Uhrzeit sortieren' }).click();
  await expect(samstag.getByLabel('Programmpunkt').first()).toHaveValue('Morgenrunde');
  await sonntag.getByRole('button', { name: 'Ablauf vom Sa übernehmen' }).click();
  await expect(sonntag.getByLabel('Programmpunkt')).toHaveCount(4);

  // The last block of Saturday moves on to Sunday
  await samstag
    .getByRole('button', { name: '„Lagerfeuer“ auf Sonntag, 02.08.2026 verschieben' })
    .click();
  await expect(samstag.getByLabel('Programmpunkt')).toHaveCount(3);
  await expect(sonntag.getByLabel('Programmpunkt').first()).toHaveValue('Lagerfeuer');

  // Deleting can be undone
  await sonntag.getByRole('button', { name: '„Lagerfeuer“ löschen' }).first().click();
  await expect(sonntag.getByLabel('Programmpunkt')).toHaveCount(4);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(sonntag.getByLabel('Programmpunkt')).toHaveCount(5);
  await expectNoHorizontalOverflow(page);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als PDF herunterladen' }).click();
  expect((await download).suggestedFilename()).toBe(
    'Kurzbeschreibung Sommerlager 2026 Oberjoch.pdf'
  );

  await expect(page.getByTestId('eingaben-ablage')).toContainText('Ungespeicherte Änderungen');
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText('Gespeichert am');
  await page.reload();
  await expect(page.getByLabel('Zielsetzung')).toHaveValue(
    'Wir stärken die Gemeinschaft im Stamm.'
  );
  await expect(
    page.getByRole('region', { name: 'Sonntag, 02.08.2026' }).getByLabel('Programmpunkt')
  ).toHaveCount(5);
});

test('a Zeitplan read from a file replaces the entered one only after asking', async ({ page }) => {
  await page.goto(URL);
  // A day with lines not taken over yet is removed only after asking
  const dienstag = page.getByRole('region', { name: 'Dienstag, 11.08.2026' });
  await dienstag.getByRole('button', { name: 'Mehrere Zeilen einfügen' }).click();
  await dienstag.getByLabel('Mehrere Blöcke, einer pro Zeile').fill('10 Uhr Abreise');
  await dienstag.getByRole('button', { name: 'Tag entfernen' }).click();
  await answerConfirm(page, 'Dienstag, 11.08.2026 entfernen?', 'Abbrechen');
  await expect(dienstag.getByLabel('Mehrere Blöcke, einer pro Zeile')).toHaveValue(
    '10 Uhr Abreise'
  );
  await dienstag.getByRole('button', { name: 'Tag entfernen' }).click();
  await answerConfirm(page, 'Dienstag, 11.08.2026 entfernen?', 'Tag entfernen');
  await expect(dienstag).toHaveCount(0);

  const samstag = page.getByRole('region', { name: 'Samstag, 01.08.2026' });
  await samstag.getByRole('button', { name: 'Block hinzufügen' }).click();
  await samstag.getByLabel('Programmpunkt').fill('Packen');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Aus Datei übernehmen', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'Zeitplan.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('PK demo'),
  });
  await answerConfirm(page, 'Zeitplan ersetzen?', 'Zeitplan ersetzen');
  await expect(
    page.getByText(/Zeitplan aus „Zeitplan.xlsx“ übernommen: 2 Tage, 8 Blöcke/).first()
  ).toBeVisible();
  await expect(samstag.getByLabel('Programmpunkt')).toHaveCount(5);
  await expect(samstag.getByLabel('Programmpunkt').first()).toHaveValue('Anreise und Aufbau');
  await expect(page.getByLabel('Zielsetzung')).toHaveValue(
    'Mit der Aktion wollen wir die Gemeinschaft im Stamm stärken.'
  );
  // The other days of the Aktion stay
  await expect(page.getByRole('region', { name: 'Dienstag, 11.08.2026' })).toBeVisible();

  await page.route('**/zeitplan', (route) =>
    route.fulfill({
      status: 502,
      json: {
        code: 'READ_UNAVAILABLE',
        message: 'Der Zeitplan konnte gerade nicht ausgelesen werden. Es wurde nichts geändert.',
      },
    })
  );
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Aus Datei übernehmen', exact: true }).click();
  await (
    await again
  ).setFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: Buffer.from('8;Frühstück') });
  await expect(page.getByText(/Es wurde nichts geändert/).first()).toBeVisible();
  await expect(samstag.getByLabel('Programmpunkt')).toHaveCount(5);
});

test('a description in own words becomes Zielsetzung and Zeitplan once', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: 'In eigenen Worten beschreiben' }).click();
  const beschreibung = page.getByLabel('Ablauf der Aktion');
  await expect(beschreibung).toBeFocused();
  await beschreibung.fill(
    'Wir wollen die Gemeinschaft stärken. Samstag um 10 Anreise, nachmittags Geländespiel.'
  );
  // The description survives a look at another tab
  await page.getByRole('tab', { name: /Übersicht/ }).click();
  await page.getByRole('tab', { name: 'Kurzbeschreibung' }).click();
  await expect(page.getByLabel('Ablauf der Aktion')).toHaveValue(/Gemeinschaft stärken/);

  await page.getByRole('button', { name: 'Kurzbeschreibung erstellen' }).click();
  await expect(
    page.getByText(/Zeitplan aus deiner Beschreibung übernommen: 2 Tage, 8 Blöcke/).first()
  ).toBeVisible();
  await expect(page.getByLabel('Ablauf der Aktion')).toHaveCount(0);
  await expect(page.getByLabel('Zielsetzung')).toHaveValue(
    'Mit der Aktion wollen wir die Gemeinschaft im Stamm stärken.'
  );
  const samstag = page.getByRole('region', { name: 'Samstag, 01.08.2026' });
  await expect(samstag.getByLabel('Programmpunkt').first()).toHaveValue('Anreise und Aufbau');
  await expectNoHorizontalOverflow(page);
});

test('an answer that arrives after the Kurzbeschreibung changed is not taken over', async ({
  page,
}) => {
  await page.goto(URL);
  await page.route('**/zeitplan', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByRole('button', { name: 'In eigenen Worten beschreiben' }).click();
  await page.getByLabel('Ablauf der Aktion').fill('Samstag um 10 Anreise.');
  await page.getByRole('button', { name: 'Kurzbeschreibung erstellen' }).click();
  await page.getByLabel('Zielsetzung').fill('Selbst geschrieben.');
  await expect(page.getByText(/während der Zeitplan gelesen wurde/).first()).toBeVisible();
  await expect(page.getByLabel('Zielsetzung')).toHaveValue('Selbst geschrieben.');
  await expect(
    page.getByRole('region', { name: 'Samstag, 01.08.2026' }).getByLabel('Programmpunkt')
  ).toHaveCount(0);
  // The description stays for another try
  await expect(page.getByLabel('Ablauf der Aktion')).toHaveValue('Samstag um 10 Anreise.');
});

test('an empty block alone gives no PDF but a hint what to enter', async ({ page }) => {
  await page.goto(URL);
  await page
    .getByRole('region', { name: 'Samstag, 01.08.2026' })
    .getByRole('button', { name: 'Block hinzufügen' })
    .click();
  await page.getByRole('button', { name: 'Als PDF herunterladen' }).click();
  await expect(
    page.getByText('Trage zuerst die Zielsetzung oder einen Block im Zeitplan ein.')
  ).toBeVisible();
});
