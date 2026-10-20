import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';

test('the entries of an Aktion are kept on the device until they are reset', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const zusatztag = page.getByRole('checkbox', { name: /Zusatztag/ });
  const ablage = page.getByTestId('eingaben-ablage');
  const reset = page.getByRole('button', { name: 'Eingaben zurücksetzen' });
  await expect(zusatztag).toBeVisible();
  await expect(ablage).toContainText('Deine Eingaben werden auf diesem Gerät gespeichert.');
  await expect(reset).toHaveCount(0);

  await zusatztag.check();
  // The fixtures fix the clock at 2026-10-01 12:00 UTC
  await expect(ablage).toContainText(
    'Deine Eingaben sind auf diesem Gerät gespeichert, zuletzt am 01.10.2026, 14:00 Uhr.'
  );
  // The KJR deadline of the Sommerlager is 11.11.2026; the entries are kept one month longer
  await page.getByRole('button', { name: 'Erklärung zu Deine Eingaben' }).click();
  await expect(ablage).toContainText('Nach dem 11.12.2026 werden sie gelöscht');
  await page.keyboard.press('Escape');

  // Leaving does not ask, and the entry is back on the next visit
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Abrechnung', exact: true })
    .click();
  await expect(page).toHaveURL(/\/leitendenbereich\/abrechnung$/);
  await page.getByRole('link', { name: /Sommerlager 2026 Oberjoch/ }).click();
  await expect(zusatztag).toBeChecked();
  await expect(ablage).toContainText('zuletzt am');

  // … also after a reload
  await page.reload();
  await expect(zusatztag).toBeChecked();
  expect(dialogs).toEqual([]);

  // Resetting asks first, naming the Aktion
  await reset.click();
  await expect(page.getByRole('dialog', { name: 'Eingaben zurücksetzen?' })).toContainText(
    'Alle Eingaben zur Abrechnung „Sommerlager 2026 Oberjoch“ auf diesem Gerät löschen?'
  );
  await answerConfirm(page, 'Eingaben zurücksetzen?', 'Abbrechen');
  await expect(zusatztag).toBeChecked();
  await reset.click();
  await answerConfirm(page, 'Eingaben zurücksetzen?', 'Eingaben zurücksetzen');
  await expect(zusatztag).not.toBeChecked();
  await expect(page.getByText('Eingaben zurückgesetzt.')).toBeVisible();
  await expect(reset).toHaveCount(0);
  await expect(ablage).not.toContainText('zuletzt am');
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(zusatztag).not.toBeChecked();
  expect(dialogs).toEqual([]);
});

test('without storage the entries last while the page is open and leaving asks', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const blocked = (): never => {
      throw new DOMException('Blocked', 'SecurityError');
    };
    Storage.prototype.getItem = blocked;
    Storage.prototype.setItem = blocked;
    Storage.prototype.removeItem = blocked;
  });
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const zusatztag = page.getByRole('checkbox', { name: /Zusatztag/ });
  await zusatztag.check();
  await expect(page.getByTestId('zuschuss-formel')).toContainText('× 11 Tage');
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'gehen beim Schließen der Seite verloren'
  );
  await expect(page.getByRole('button', { name: 'Eingaben zurücksetzen' })).toHaveCount(0);

  // Leaving warns first; staying keeps the entry
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Abrechnung', exact: true })
    .click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(page).toHaveURL(/evt_Sola26/);
  await expect(zusatztag).toBeChecked();
});

test('when the device is full, the older stored entries can still be reset', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      if ((window as { storageFull?: boolean }).storageFull) {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const zusatztag = page.getByRole('checkbox', { name: /Zusatztag/ });
  await zusatztag.check();
  await expect(page.getByTestId('eingaben-ablage')).toContainText('zuletzt am');

  // A later change does not fit any more; the older entry is still on the device
  await page.evaluate(() => ((window as { storageFull?: boolean }).storageFull = true));
  await page.getByLabel('Vorkalkulation von').fill('Kim Muster');
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'gehen beim Schließen der Seite verloren'
  );
  await page.getByRole('button', { name: 'Eingaben zurücksetzen' }).click();
  await answerConfirm(page, 'Eingaben zurücksetzen?', 'Eingaben zurücksetzen');
  await expect(page.getByText('Eingaben zurückgesetzt.').first()).toBeVisible();

  await page.reload();
  await expect(zusatztag).not.toBeChecked();
});

test('entries made in two tabs of the same Aktion are both kept', async ({ page, context }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const other = await context.newPage();
  await other.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(other.getByLabel('Vorkalkulation von')).toBeVisible();

  // The first tab enters something, then the second tab, opened before, enters something else
  await page.getByRole('checkbox', { name: /Zusatztag/ }).check();
  await expect(other.getByRole('checkbox', { name: /Zusatztag/ })).toBeChecked();
  await other.getByLabel('Vorkalkulation von').fill('Kim Muster');
  await expect(page.getByLabel('Vorkalkulation von')).toHaveValue('Kim Muster');

  await other.close();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).toBeChecked();
  await expect(page.getByLabel('Vorkalkulation von')).toHaveValue('Kim Muster');
});

test('entries are deleted from the device one month after the KJR deadline', async ({ page }) => {
  const stored = (deleteAfter: string): string =>
    JSON.stringify({
      savedAt: '2026-08-20T10:00:00.000Z',
      deleteAfter,
      session: { zusatztag: true },
    });
  await page.goto('/impressum');
  // The fixtures fix the clock at 2026-10-01
  await page.evaluate(
    ([expired, current]) => {
      localStorage.setItem('phoenix:abrechnung:v1:evt_Sola26', expired);
      localStorage.setItem('phoenix:abrechnung:v1:evt_Andere', current);
    },
    [stored('2026-09-30'), stored('2026-10-01')]
  );

  // Any page of the website removes what is past its last day and keeps the rest
  await page.goto('/');
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('phoenix:abrechnung:'))
  );
  expect(keys).toEqual(['phoenix:abrechnung:v1:evt_Andere']);

  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).not.toBeChecked();
});

test('after its last day an Aktion keeps new entries only while the page is open', async ({
  page,
}) => {
  // The KJR deadline of the Sommerlager is 11.11.2026, its entries are kept until 11.12.2026
  await page.clock.setFixedTime(new Date('2026-12-20T12:00:00Z'));
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const zusatztag = page.getByRole('checkbox', { name: /Zusatztag/ });
  await zusatztag.check();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Deine Eingaben werden nicht mehr auf diesem Gerät gespeichert'
  );
  expect(
    await page.evaluate(() => localStorage.getItem('phoenix:abrechnung:v1:evt_Sola26'))
  ).toBeNull();

  // Leaving warns first, as the entry would be lost
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Abrechnung', exact: true })
    .click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(zusatztag).toBeChecked();
});

test('a moved Aktion gets the new deletion day for its stored entries', async ({ page }) => {
  await page.goto('/impressum');
  await page.evaluate(() =>
    localStorage.setItem(
      'phoenix:abrechnung:v1:evt_Sola26',
      JSON.stringify({
        savedAt: '2026-09-20T10:00:00.000Z',
        deleteAfter: '2026-12-31',
        session: { zusatztag: true },
      })
    )
  );
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await page.getByRole('button', { name: 'Erklärung zu Deine Eingaben' }).click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Nach dem 11.12.2026 werden sie gelöscht'
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('phoenix:abrechnung:v1:evt_Sola26') ?? 'null')
  );
  // The last day follows the Aktion's current dates; the time of the last change stays
  expect(stored).toMatchObject({
    savedAt: '2026-09-20T10:00:00.000Z',
    deleteAfter: '2026-12-11',
  });
});

test('an expired login while loading a receipt offers the new login', async ({ page }) => {
  await page.route('**/api/intern/abrechnung/belege/*/bild*', (route) =>
    route.fulfill({ status: 401, body: '' })
  );
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=nachweise');
  await page
    .getByRole('row', { name: /2026-103/ })
    .getByRole('button', { name: /Zeltplatz/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Beleg 2026-103' });
  await expect(dialog).toContainText('Deine Anmeldung ist abgelaufen.');
  await expect(dialog.getByRole('link', { name: 'Neu anmelden (öffnet neuen Tab)' })).toBeVisible();
});

test('an Aktion moved past its last day removes the stored entries', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-12-20T12:00:00Z'));
  await page.goto('/impressum');
  // Stored when the Aktion still ended later
  await page.evaluate(() =>
    localStorage.setItem(
      'phoenix:abrechnung:v1:evt_Sola26',
      JSON.stringify({
        savedAt: '2026-11-20T10:00:00.000Z',
        deleteAfter: '2026-12-31',
        session: { zusatztag: true },
      })
    )
  );
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Deine Eingaben werden nicht mehr auf diesem Gerät gespeichert'
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('phoenix:abrechnung:v1:evt_Sola26')))
    .toBeNull();
});

test('leaving a page with unsaved entries asks in the app dialog, for links and back', async ({
  page,
}) => {
  page.on('dialog', (dialog) => {
    throw new Error(`Unexpected browser prompt: ${dialog.message()}`);
  });
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: /Eigenbeleg/ }).click();
  await expect(page).toHaveURL(/\/eigenbeleg$/);
  const paidTo = page.getByLabel('Bezahlt an');
  await paidTo.fill('Parkhaus Oberjoch');

  // Back asks too and keeps the page and the entry when the user stays
  await page.goBack();
  const ask = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(ask).toContainText('noch nicht gespeichert');
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(page).toHaveURL(/\/eigenbeleg$/);
  await expect(paidTo).toHaveValue('Parkhaus Oberjoch');

  // Discarding goes back after all
  await page.goBack();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Änderungen verwerfen');
  await expect(page).toHaveURL(/\/leitendenbereich\/?$/);

  // A link continues to its target after discarding
  await page.goto('/leitendenbereich/eigenbeleg');
  await paidTo.fill('Bäckerei');
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Übersicht' })
    .click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Änderungen verwerfen');
  await expect(page).toHaveURL(/\/leitendenbereich\/?$/);
});
