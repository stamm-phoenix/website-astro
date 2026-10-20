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

test('a discarded load cannot overwrite a reopened draft or its unsaved warning', async ({
  page,
}) => {
  await page.goto('/impressum');
  const result = await page.evaluate(async () => {
    const path = '/src/lib/abrechnungStore.svelte.ts';
    const store = await import(path);
    const id = 'evt_Sola26';
    const originalFetch = window.fetch;
    const baseline = await (await originalFetch(`/api/intern/abrechnung/${id}/eingaben`)).json();
    let calls = 0;
    let release!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      release = resolve;
    });
    window.fetch = (input, init) => {
      if (String(input).includes(`/abrechnung/${id}/eingaben`)) {
        calls++;
        return calls === 2 ? delayed : Promise.resolve(Response.json(baseline));
      }
      return originalFetch(input, init);
    };
    const loaded = async () => {
      while (!store.abrechnungAblage[id]?.loaded)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    try {
      store.abrechnungSession(id);
      await loaded();
      const stale = store.loadAbrechnungSession(id);
      store.resetAbrechnungSession(id);
      const reopened = store.abrechnungSession(id);
      await loaded();
      reopened.kjr.ort = 'Neue Eingabe nach dem Wiederöffnen';
      store.storeAbrechnungSession(id);
      release(Response.json(baseline));
      await stale;
      store.storeAbrechnungSession(id);
      return { ort: reopened.kjr.ort, dirty: store.abrechnungAblage[id].dirty };
    } finally {
      window.fetch = originalFetch;
      store.resetAbrechnungSession(id);
    }
  });
  expect(result).toEqual({ ort: 'Neue Eingabe nach dem Wiederöffnen', dirty: true });
});

test('an undated Aktion keeps its accounting and receipts accessible while explaining the save restriction', async ({
  page,
}) => {
  await page.route('**/api/intern/abrechnung/evt_Sola26', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.event.start_date = null;
    data.event.end_date = null;
    await route.fulfill({ json: data });
  });
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Einnahmen und Ausgaben' })).toBeVisible();
  await expect(page.getByTestId('eingaben-ablage')).toContainText('noch kein Datum in CampFlow');
  await page.getByRole('tab', { name: /Leihgebühren/ }).click();
  await page.getByLabel('Anzahl Jurte').fill('2');
  await expect(page.getByRole('button', { name: 'Eingaben speichern' })).toBeDisabled();
  await page.getByRole('tab', { name: /Einzelnachweise/ }).click();
  await expect(page.getByRole('row', { name: /2026-103/ })).toBeVisible();
});

test('same-window iPhone login restores the complete unsaved accounting draft', async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto(URL);
  await page.getByRole('checkbox', { name: /Zusatztag/ }).check();
  await page.getByRole('tab', { name: /Teilnehmende/ }).click();
  await page.getByLabel('PLZ Gast München').fill('83620');
  await page.getByRole('tab', { name: /Leihgebühren/ }).click();
  await page.getByLabel('Anzahl Jurte').fill('2');
  await page.getByLabel('Tage Jurte').fill('4');
  await page.route('**/eingaben', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  const storage = page.getByTestId('eingaben-ablage');
  await expect(storage).toContainText('Deine Anmeldung ist abgelaufen');
  await page.unroute('**/eingaben');
  const returned = page.waitForEvent('domcontentloaded');
  await storage.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await returned;
  await expect(storage).toContainText('Deine Eingaben wurden nach der Anmeldung wiederhergestellt');
  await expect(page.getByLabel('Anzahl Jurte')).toHaveValue('2');
  await expect(page.getByLabel('Tage Jurte')).toHaveValue('4');
  await expect(storage).toContainText('Ungespeicherte Änderungen');
  await page.getByRole('tab', { name: /Teilnehmende/ }).click();
  await expect(page.getByLabel('PLZ Gast München')).toHaveValue('83620');
  await page.getByRole('tab', { name: 'Übersicht' }).click();
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).toBeChecked();
  expect(
    await page.evaluate(() => sessionStorage.getItem('phoenix:gerettete-eingaben:v1'))
  ).toBeNull();
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect(storage).toContainText('Auf allen deinen Geräten verfügbar');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).toBeChecked();
});

test('recovered accounting inputs do not overwrite a newer saved version during login', async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto(URL);
  await page.getByRole('checkbox', { name: /Zusatztag/ }).check();
  await page.route('**/eingaben', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  const storage = page.getByTestId('eingaben-ablage');
  await expect(storage).toContainText('Deine Anmeldung ist abgelaufen');
  const current = await (await page.request.get(API)).json();
  current.session.kjr.ort = 'Inzwischen auf einem anderen Gerät';
  expect(
    (await page.request.put(API, { data: { session: current.session, etag: current.etag } })).ok()
  ).toBe(true);
  await page.unroute('**/eingaben');
  const returned = page.waitForEvent('domcontentloaded');
  await storage.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await returned;
  await expect(storage).toContainText('während der Anmeldung geändert');
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Eingaben speichern' })).toBeDisabled();
  const saved = await (await page.request.get(API)).json();
  expect(saved.session.zusatztag).toBe(false);
  expect(saved.session.kjr.ort).toBe('Inzwischen auf einem anderen Gerät');
  // A second login must retain the same conflict, rather than adopting the new server version.
  await page.route('**/api/intern/abrechnung/evt_Sola26?*', (route) =>
    route.fulfill({ status: 401 })
  );
  await page.getByRole('button', { name: 'Neu laden', exact: true }).click();
  const login = page.getByRole('link', { name: 'Neu anmelden', exact: true });
  await expect(login).toBeVisible();
  await page.unroute('**/api/intern/abrechnung/evt_Sola26?*');
  const returnedAgain = page.waitForEvent('domcontentloaded');
  await login.click();
  await returnedAgain;
  await expect(storage).toContainText('während der Anmeldung geändert');
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Eingaben speichern' })).toBeDisabled();
});

test('accounting recovery is not applied to a different account after login', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto(URL);
  await page.getByRole('checkbox', { name: /Zusatztag/ }).check();
  await page.route('**/eingaben', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  const storage = page.getByTestId('eingaben-ablage');
  await expect(storage).toContainText('Deine Anmeldung ist abgelaufen');
  const principal = await (await page.request.get('/.auth/me')).json();
  principal.clientPrincipal.userId = 'another-account';
  await page.route('**/.auth/me', (route) => route.fulfill({ json: principal }));
  await page.unroute('**/eingaben');
  const returned = page.waitForEvent('domcontentloaded');
  await storage.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await returned;
  await expect(page.getByRole('checkbox', { name: /Zusatztag/ })).not.toBeChecked();
  await expect(storage).not.toContainText(
    'Deine Eingaben wurden nach der Anmeldung wiederhergestellt'
  );
});
