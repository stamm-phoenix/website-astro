import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

test('the Leitendenbereich can be installed and the app starts on its start page', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/leitendenbereich.webmanifest');
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    start_url: '/leitendenbereich-app/',
    display: 'standalone',
    short_name: 'Leitende',
    // Firefox colors the status bar only from here, in every theme
    theme_color: '#101b26',
    background_color: '#101b26',
  });
  for (const icon of manifest.icons) {
    expect((await page.request.get(icon.src)).ok(), icon.src).toBe(true);
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png'
  );
});

test('the start page of the app opens the Leitendenbereich when logged in', async ({ page }) => {
  await page.goto('/leitendenbereich-app/');
  await expect(page).toHaveURL(/\/leitendenbereich\/$/);
});

test('the start page of the app leads to the login that comes back to the Leitendenbereich', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'mock_logged_out', value: '1', url: baseURL! }]);
  const login = page.waitForRequest((request) => new URL(request.url()).pathname === '/login');
  await page.goto('/leitendenbereich-app/');
  await login;
});

test('the start page of the app says what to do without a connection', async ({ page }) => {
  await page.route('**/.auth/me', (route) => route.abort('internetdisconnected'));
  await page.goto('/leitendenbereich-app/');
  await expect(page.getByRole('status')).toContainText('Prüf deine Internetverbindung');
  await page.unroute('**/.auth/me');
  await page.getByRole('link', { name: 'Noch einmal versuchen' }).click();
  await expect(page).toHaveURL(/\/leitendenbereich\/$/);
});

test('no page of the Leitendenbereich registers a service worker', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { swCalls: string[] }).swCalls = calls;
    navigator.serviceWorker.register = (url: string | URL) => {
      calls.push(String(url));
      return Promise.reject(new Error('blocked by test'));
    };
  });
  for (const path of ['/leitendenbereich-app/', '/leitendenbereich/aufgaben']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => (window as unknown as { swCalls: string[] }).swCalls)).toEqual(
      []
    );
  }
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations())).toEqual([]);
});

test('public pages do not offer the Leitendenbereich for installation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

test('without a connection the Leitendenbereich says to keep the page open', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/');
  const notice = page.getByText('Keine Verbindung zum Internet.');
  await expect(notice).toBeHidden();
  await context.setOffline(true);
  await expect(notice).toBeVisible();
  await expect(
    page.getByText('Lass diese Seite offen, deine Eingaben bleiben stehen.')
  ).toBeVisible();
  await context.setOffline(false);
  await expect(notice).toBeHidden();
});

test('the Fahrt view keeps its own offline notice without the general one', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/nikolaus-fahrt');
  await context.setOffline(true);
  await expect(page.getByText('Keine Verbindung zum Internet.')).toHaveCount(0);
  await context.setOffline(false);
});

test('the Abrechnung says that it keeps saving on the device without a connection', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(page.getByRole('tab', { name: 'Leihgebühren' })).toBeVisible();
  await context.setOffline(true);
  const notice = page.getByText('Keine Verbindung zum Internet.');
  await expect(notice).toBeVisible();
  await expect(page.locator('[data-offline-notice]')).toContainText(
    'Deine Eingaben bleiben auf dieser offenen Seite stehen.'
  );
  await expect(page.locator('[data-offline-notice]')).not.toContainText('Speichern');
  await context.setOffline(false);
});

async function expireLoginInIphoneApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/gruppenstunden/*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  // The fragment holds a view, e.g. of the photos, and must come back too
  await page.goto('/leitendenbereich/gruppenstunden#ansicht=liste');
}

test('in the iPhone app the edit dialog fills in its input again after the new login', async ({
  page,
}) => {
  await expireLoginInIphoneApp(page);
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Wölflinge bearbeiten' });
  await dialog.getByLabel('Alter').fill('16 bis 20 Jahre');
  const beschreibung = dialog.getByRole('textbox', { name: 'Beschreibung' });
  await beschreibung.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Neu: Hüttenwochenende.');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'setzt es die gesicherten Eingaben selbst ein'
  );
  const login = dialog.getByRole('link', { name: 'Neu anmelden', exact: true });
  await expect(login).toHaveAttribute(
    'href',
    `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent('/leitendenbereich/gruppenstunden#ansicht=liste')}`
  );
  await expect(login).not.toHaveAttribute('target', '_blank');
  await login.click();

  // The login reloaded the page: the hint says which form to open again
  const hint = page.getByRole('region', { name: 'Deine Eingaben sind gesichert' });
  await expect(hint).toContainText('„Gruppenstunde Wölflinge bearbeiten“');
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)' }).click();
  await expect(dialog.getByLabel('Alter')).toHaveValue('16 bis 20 Jahre');
  await expect(beschreibung).toContainText('Neu: Hüttenwochenende.');
  await expect(dialog.getByText('wieder eingesetzt. Prüf sie und speichere.')).toBeVisible();
  await expect(hint).toHaveCount(0);

  // Filled in once: closing asks first, and the next opening shows the saved values
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('button', { name: 'Änderungen verwerfen' }).click();
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)' }).click();
  await expect(dialog.getByLabel('Alter')).not.toHaveValue('16 bis 20 Jahre');
});

test('in the iPhone app the login waits when the input cannot be kept', async ({ page }) => {
  await expireLoginInIphoneApp(page);
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Wölflinge bearbeiten' });
  await dialog.getByLabel('Alter').fill('16 bis 20 Jahre');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'ließen sich auf diesem Gerät nicht sichern'
  );
  await expect(page).toHaveURL(/\/leitendenbereich\/gruppenstunden#ansicht=liste$/);
  await expect(dialog.getByLabel('Alter')).toHaveValue('16 bis 20 Jahre');
  await expect(dialog.getByRole('link', { name: 'Trotzdem neu anmelden' })).toBeVisible();
});

test('in the iPhone app a protected link keeps its fragment through the login', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.goto('/leitendenbereich/');
  // Like a link to a photo folder in the minutes, which opens in a new window
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/leitendenbereich/fotos#pfad=2026%2FSola';
    link.target = '_blank';
    link.textContent = 'Fotos vom Sola';
    document.getElementById('staff-content')?.prepend(link);
  });
  const [login] = await Promise.all([
    context.waitForEvent('request', (request) => request.url().includes('/.auth/login/aad')),
    page.getByRole('link', { name: 'Fotos vom Sola' }).click(),
  ]);
  expect(new URL(login.url()).searchParams.get('post_login_redirect_uri')).toBe(
    '/leitendenbereich/fotos#pfad=2026%2FSola'
  );
});

test('in the iPhone app a newer FAQ answer is preserved and the earlier draft stays accessible', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const created = await page.request.post('/api/intern/pflege/qa', {
    data: {
      question: 'Recovery conflict question',
      // Formatted, and long, so the earlier draft below the fields is longer than a phone screen
      answer:
        '<p>Original answer</p>' +
        '<p>Siehe <strong>unbedingt</strong> die <a href="https://example.org/treffpunkt">Karte</a>.</p>' +
        Array.from(
          { length: 15 },
          (_, index) =>
            `<p>Geretteter Absatz ${index}: Dieser längere Text soll sich lesen und kopieren lassen.</p>`
        ).join(''),
      category: 'Allgemein',
      published: false,
    },
  });
  const { id } = await created.json();
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route(`**/api/intern/pflege/qa/${id}`, (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/fragen-und-antworten');
  await page
    .getByRole('button', { name: 'Bearbeiten: Recovery conflict question', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Frage bearbeiten', exact: true });
  await dialog.getByLabel('Frage', { exact: true }).fill('My unsaved question');
  await expect(dialog.getByRole('textbox', { name: 'Antwort' })).toContainText('Original answer');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  // Another person changes only the editor content while this tab is signing in.
  expect(
    (
      await page.request.patch(`/api/intern/pflege/qa/${id}`, {
        data: { answer: '<p>Newer answer from someone else</p>' },
      })
    ).ok()
  ).toBe(true);
  await page.reload();
  await page
    .getByRole('button', { name: 'Bearbeiten: Recovery conflict question', exact: true })
    .click();
  await expect(dialog.getByRole('textbox', { name: 'Antwort' })).toContainText(
    'Newer answer from someone else'
  );
  await expect(dialog.getByLabel('Frage', { exact: true })).toHaveValue(
    'Recovery conflict question'
  );
  const draft = dialog.getByRole('region', { name: 'Noch nicht eingesetzt' });
  await expect(draft).toContainText('My unsaved question');
  await expect(draft).toContainText('Original answer');
  await expect(draft).not.toContainText('<p>');
  await expect(draft.getByRole('link', { name: 'Karte' })).toHaveAttribute(
    'href',
    'https://example.org/treffpunkt'
  );
  await expect(
    dialog.getByText('Dieser Eintrag wurde inzwischen geändert.', { exact: false })
  ).toBeVisible();
  // The long draft leaves the fields and the save button reachable on the phone
  await expect(dialog.getByLabel('Frage', { exact: true })).toBeInViewport();
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
  await expect(save).toBeInViewport();
  const copy = draft.getByRole('button', { name: 'Antwort kopieren', exact: true });
  await copy.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  // The copied answer keeps its formatting and its labelled link when pasted
  await copy.click();
  await expect(draft.getByText('Kopiert.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'Siehe unbedingt die Karte.'
  );
  const answer = dialog.getByRole('textbox', { name: 'Antwort', exact: true });
  await answer.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(answer.locator('strong')).toHaveText('unbedingt');
  await expect(answer.getByRole('link', { name: 'Karte' })).toHaveAttribute(
    'href',
    'https://example.org/treffpunkt'
  );
  await expect(answer).not.toContainText('<p>');
  await expect(save).toBeInViewport();
  await page.unroute(`**/api/intern/pflege/qa/${id}`);
  await save.click();
  await expect(dialog).toBeHidden();
  const current = await (await page.request.get('/api/intern/pflege/qa')).json();
  expect(current.items.find((item: { id: string }) => item.id === id).answer).toContain(
    'Newer answer from someone else'
  );
  await page.request.delete(`/api/intern/pflege/qa/${id}`);
});

test('in the iPhone app a newly created person keeps later edits under their saved ID', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/leitendenbereich/leitende');
  await page.getByRole('button', { name: 'Neue Person', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Recovery new person');
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recovery new person bearbeiten', exact: true });
  await expect(
    dialog.getByText('Du kannst jetzt ein Foto hinzufügen.', { exact: false })
  ).toBeVisible();
  // Creation keeps the same dialog mounted; only subsequent writes expire.
  await page.route('**/api/intern/pflege/leitende/*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await dialog.getByLabel('Name', { exact: true }).fill('Recovery edited person');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await page.getByRole('button', { name: /Recovery new person/ }).click();
  await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue(
    'Recovery edited person'
  );
});

test('in the iPhone app template rows come back when added, and saving or discarding ends the kept input', async ({
  page,
}) => {
  await page.request.post('/api/__mock/aufgaben/reset');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/aufgaben/vorlagen', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aufgaben/vorlagen');
  const open = page.getByRole('button', { name: 'Vorlage anlegen' });
  const dialog = page.getByRole('dialog', { name: 'Vorlage' });
  const add = dialog.getByRole('button', { name: 'Vorlagenaufgabe hinzufügen' });
  const save = dialog.getByRole('button', {
    name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
  });
  const hint = page.getByRole('region', { name: 'Deine Eingaben sind gesichert' });
  const leftOver = dialog.getByRole('region', { name: 'Noch nicht eingesetzt' });
  /** Fills in a new template, fails to save it, logs in again and opens the dialog again. */
  async function keepAcrossLogin(title: string, rows: string[]): Promise<void> {
    await open.click();
    await dialog.getByLabel('Titel', { exact: true }).fill(title);
    for (const [index, row] of rows.entries()) {
      if (index > 0) await add.click();
      await dialog.getByLabel('Aufgabentitel').nth(index).fill(row);
      await dialog
        .getByLabel('Tage vor der Aktion')
        .nth(index)
        .fill(String(10 - index));
    }
    await save.click();
    await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
    await open.click();
  }

  // Rows missing after the login wait below the form and take their fields when added
  await keepAcrossLogin('Zeltlager', ['Zelte prüfen', 'Einkauf planen', 'Bus buchen']);
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Zeltlager');
  await expect(dialog.getByLabel('Aufgabentitel').first()).toHaveValue('Zelte prüfen');
  await expect(leftOver).toContainText('Einkauf planen');
  await expect(leftOver).toContainText('Bus buchen');
  await expect(
    dialog.getByText('Den Rest findest du im Abschnitt „Noch nicht eingesetzt“.')
  ).toBeVisible();
  await add.click();
  await expect(dialog.getByLabel('Aufgabentitel').nth(1)).toHaveValue('Einkauf planen');
  await expect(dialog.getByLabel('Tage vor der Aktion').nth(1)).toHaveValue('9');
  await expect(leftOver).toContainText('Bus buchen');
  await expect(leftOver).not.toContainText('Einkauf planen');

  // Discarding with a row still missing ends the kept input
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  await expect(dialog).toBeHidden();
  await open.click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('');
  await expect(hint).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();

  // Saving with rows still missing ends it too: the template dialog is removed, not closed
  await keepAcrossLogin('Hüttenwochenende', ['Hütte buchen', 'Schlüssel holen']);
  await expect(leftOver).toBeVisible();
  await page.unroute('**/api/intern/pflege/aufgaben/vorlagen');
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(hint).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem('phoenix:gerettete-eingaben:v1'))
  ).toBeNull();
  await open.click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('');
});

test('in the iPhone app selected task assignees survive a new login with their identities', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/__mock/aufgaben/reset');
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route('**/api/intern/pflege/aufgaben', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aufgaben');
  const open = page.getByRole('button', { name: 'Aufgabe anlegen', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe anlegen', exact: true });
  await dialog.getByLabel('Titel', { exact: true }).fill('Recovery assignees');
  for (const name of ['Alex Beispiel', 'Bea Beispiel']) {
    await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).fill(name);
    await dialog.getByRole('option', { name, exact: true }).click();
  }
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await open.click();
  for (const name of ['Alex Beispiel', 'Bea Beispiel']) {
    await expect(
      dialog.getByRole('button', { name: `${name} entfernen`, exact: true })
    ).toBeVisible();
  }
  await page.unroute('**/api/intern/pflege/aufgaben');
  const write = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/pflege/aufgaben')
  );
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  expect((await write).postDataJSON().assignees).toEqual([
    { name: 'Alex Beispiel', login: 'alex@example.test' },
    { name: 'Bea Beispiel', login: 'bea@example.test' },
  ]);
});

test('in the iPhone app receipt login links warn that the chosen photo and crop must be redone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route('**/api/intern/pflege/belege/pruefung', (route) =>
    route.fulfill({ status: 401 })
  );
  await page.route('**/api/intern/pflege/belege', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/belege');
  const open = page.getByRole('button', { name: 'Beleg einreichen', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen', exact: true });
  const warning = 'Das ausgewählte Foto und sein Zuschnitt werden nicht gesichert.';
  await expect(dialog.getByText(warning, { exact: false })).toHaveCount(0);
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 800, 1200);
    context.fillStyle = '#fff';
    context.fillRect(120, 120, 560, 960);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  });
  await expect(dialog.getByAltText('Vorschau des Fotos')).toBeVisible();
  await dialog.getByRole('button', { name: 'Zuschneiden', exact: true }).click();
  await dialog.getByRole('button', { name: /Ecke oben links verschieben/ }).press('ArrowLeft');
  await dialog.getByRole('button', { name: 'Zuschneiden fertig' }).click();
  const checkNotice = dialog.getByRole('note').filter({ hasText: warning });
  await expect(checkNotice.getByRole('link', { name: 'Neu anmelden', exact: true })).toBeVisible();
  await expect(checkNotice).toContainText('Wähle das Foto nach der neuen Anmeldung erneut aus');
  await dialog.getByLabel('Geschäft').fill('Recovery receipt photo');
  await dialog.getByLabel('Betrag in €').fill('12,34');
  await dialog.getByLabel('Kostenstelle', { exact: true }).fill('Wölflings-Herbstwochenende');
  await dialog.getByLabel('Kategorie', { exact: true }).fill('Verpflegungskosten');
  // The open suggestions would cover the choice below on a small screen
  await dialog.getByLabel('Kategorie', { exact: true }).press('Escape');
  await dialog
    .getByRole('radio', { name: 'Mit meinem Geld – bitte an mich auszahlen', exact: true })
    .check();
  await dialog.getByRole('button', { name: 'Einreichen', exact: true }).click();
  const error = dialog.getByRole('alert');
  await expect(error).toContainText(warning);
  await expect(error).toContainText('schneide es wieder zu');
  await error.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await open.click();
  await expect(dialog.getByLabel('Geschäft')).toHaveValue('Recovery receipt photo');
  await expect(dialog.getByLabel('Betrag in €')).toHaveValue('12,34');
  await expect(dialog.getByAltText('Vorschau des Fotos')).toHaveCount(0);
  await expect(dialog.getByText(warning, { exact: false })).toHaveCount(0);
});
