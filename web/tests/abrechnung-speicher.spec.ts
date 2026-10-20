import { test, expect, answerConfirm, expectNoHorizontalOverflow } from './fixtures';
import { emptySession } from '../../api/lib/abrechnung-session';

const URL = '/leitendenbereich/abrechnung/evt_Sola26';
const API = '/api/intern/abrechnung/evt_Sola26/eingaben';
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith('old local entries')) return;
  const current = await (await page.request.get(API)).json();
  expect(
    (await page.request.put(API, { data: { session: emptySession(), etag: current.etag } })).ok()
  ).toBe(true);
});

test('explicit saving persists the account draft and resetting persists an empty version', async ({
  page,
}) => {
  await page.goto(URL);
  const toggle = page.getByRole('checkbox', { name: /Zusatztag/ });
  const save = page.getByRole('button', { name: 'Eingaben speichern' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByTestId('eingaben-ablage')).toContainText('Ungespeicherte Änderungen');
  await save.click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: 'Eingaben zurücksetzen' }).click();
  await answerConfirm(page, 'Eingaben zurücksetzen?', 'Eingaben zurücksetzen');
  await expect(page.getByText('Eingaben zurückgesetzt.')).toBeVisible();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expectNoHorizontalOverflow(page);
});

test('a failed save keeps inputs and clearing the last saved value is still guarded', async ({
  page,
}) => {
  await page.goto(URL);
  const toggle = page.getByRole('checkbox', { name: /Zusatztag/ });
  const save = page.getByRole('button', { name: 'Eingaben speichern' });
  await toggle.check();
  await save.click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  await expect(save).toBeDisabled();
  await page.route('**/eingaben', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: {} }) : route.fallback()
  );
  await toggle.uncheck();
  await save.click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Die Eingaben wurden nicht gespeichert'
  );
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('eingaben-ablage')).toContainText('Ungespeicherte Änderungen');
  await page.getByRole('navigation', { name: 'Zurück' }).getByRole('link').click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(toggle).not.toBeChecked();
  await page.unroute('**/eingaben');
  await save.click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  await expect(save).toBeDisabled();
});

test('old local entries are removed only after their explicit migration succeeds', async ({
  page,
}) => {
  await page.route('**/eingaben', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: { session: emptySession(), etag: null, savedAt: null, deleteAfter: null },
        })
      : route.fallback()
  );
  await page.goto('/impressum');
  await page.evaluate(() =>
    localStorage.setItem(
      'phoenix:abrechnung:v1:evt_Sola26',
      JSON.stringify({
        session: { zusatztag: true },
        savedAt: '2026-09-30T10:00:00Z',
        deleteAfter: '2026-12-11',
      })
    )
  );
  await page.goto(URL);
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).toBeChecked();
  expect(
    await page.evaluate(() => localStorage.getItem('phoenix:abrechnung:v1:evt_Sola26'))
  ).not.toBeNull();
  await page.route('**/eingaben', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          json: {
            session: route.request().postDataJSON().session,
            etag: 'migrated',
            savedAt: '2026-10-01T12:00:00Z',
            deleteAfter: '2026-12-11',
          },
        })
      : route.fallback()
  );
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('phoenix:abrechnung:v1:evt_Sola26')))
    .toBeNull();
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

test('a failed reset preserves edits made while its request was pending', async ({ page }) => {
  await page.goto(URL);
  const toggle = page.getByRole('checkbox', { name: /Zusatztag/ });
  await toggle.check();
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route('**/eingaben', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    received();
    await pending;
    await route.fulfill({ status: 500, json: {} });
  });
  await page.getByRole('button', { name: 'Eingaben zurücksetzen' }).click();
  await answerConfirm(page, 'Eingaben zurücksetzen?', 'Eingaben zurücksetzen');
  await started;
  await toggle.uncheck();
  release();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Die Eingaben wurden nicht gespeichert'
  );
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('eingaben-ablage')).toContainText('Ungespeicherte Änderungen');
  await page.getByRole('navigation', { name: 'Zurück' }).getByRole('link').click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(toggle).not.toBeChecked();
});

test('expired retention explains why new inputs cannot be saved', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-01-01T12:00:00Z'));
  await page.goto(URL);
  await page.getByRole('checkbox', { name: /Zusatztag/ }).check();
  const storage = page.getByTestId('eingaben-ablage');
  await expect(storage).toContainText('Die Aufbewahrungsfrist ist abgelaufen');
  await expect(storage).toContainText('nur auf dieser geöffneten Seite');
  await expect(storage).not.toContainText('Tippe auf');
  await expect(page.getByRole('button', { name: 'Eingaben speichern' })).toBeDisabled();
});
