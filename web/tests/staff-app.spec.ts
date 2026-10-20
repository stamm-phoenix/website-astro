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

test('in the iPhone app a new question keeps its check mark and the link in its answer', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/qa', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/fragen-und-antworten');
  await page.getByRole('button', { name: 'Neue Frage', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Frage' });
  await dialog.getByLabel('Frage', { exact: true }).fill('Wo treffen wir uns?');
  await dialog.getByRole('checkbox', { name: /Veröffentlicht/ }).check();
  const antwort = dialog.getByRole('textbox', { name: 'Antwort' });
  await antwort.click();
  await antwort.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/html', '<p>Siehe <a href="https://example.org/treffpunkt">Karte</a></p>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(antwort.getByRole('link', { name: 'Karte' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await expect(page.getByRole('region', { name: 'Deine Eingaben sind gesichert' })).toBeVisible();
  await page.getByRole('button', { name: 'Neue Frage', exact: true }).click();
  await expect(dialog.getByLabel('Frage', { exact: true })).toHaveValue('Wo treffen wir uns?');
  await expect(dialog.getByRole('checkbox', { name: /Veröffentlicht/ })).toBeChecked();
  await expect(antwort.getByRole('link', { name: 'Karte' })).toHaveAttribute(
    'href',
    'https://example.org/treffpunkt'
  );
});

test('in the iPhone app the kept input of one task never lands in another task', async ({
  page,
}) => {
  await page.request.post('/api/__mock/aufgaben/reset');
  const created = await page.request.post('/api/intern/pflege/aufgaben', {
    data: {
      title: 'Zelte aufbauen',
      description: '',
      assignee: '',
      dueDate: null,
      projectId: null,
    },
  });
  expect(created.ok()).toBe(true);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/aufgaben/*', (route) =>
    route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 401 })
  );
  await page.goto('/leitendenbereich/aufgaben');
  // Both tasks open a dialog with the same title
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await page.getByRole('button', { name: 'Küche vorbereiten', exact: true }).click();
  await dialog.getByLabel('Titel', { exact: true }).fill('Küche aufräumen');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  const hint = page.getByRole('region', { name: 'Deine Eingaben sind gesichert' });
  await expect(hint).toBeVisible();
  await page.getByRole('button', { name: 'Zelte aufbauen', exact: true }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Zelte aufbauen');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();
  await expect(hint).toBeVisible();

  await page.getByRole('button', { name: 'Küche vorbereiten', exact: true }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Küche aufräumen');
  await expect(hint).toHaveCount(0);
});

test('in the iPhone app a renamed person gets the input back under the old title', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/leitende/*', (route) =>
    route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 401 })
  );
  await page.goto('/leitendenbereich/leitende');
  await page.getByRole('button', { name: /Lena Brandstetter/ }).click();
  // The title follows the name field
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Lena Brandstätter');
  const renamed = page.getByRole('dialog', { name: 'Lena Brandstätter bearbeiten' });
  await renamed.getByRole('button', { name: 'Speichern', exact: true }).click();
  await renamed.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await expect(page.getByRole('region', { name: 'Deine Eingaben sind gesichert' })).toContainText(
    '„Lena Brandstetter bearbeiten“'
  );
  await page.getByRole('button', { name: /Lena Brandstetter/ }).click();
  await expect(renamed.getByLabel('Name', { exact: true })).toHaveValue('Lena Brandstätter');
});

test('in the iPhone app the rows of a template come back as soon as they are added', async ({
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
  const dialog = page.getByRole('dialog', { name: 'Vorlage' });
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await dialog.getByLabel('Titel', { exact: true }).fill('Zeltlager');
  for (const [index, title] of ['Zelte prüfen', 'Einkauf planen', 'Bus buchen'].entries()) {
    if (index > 0) await dialog.getByRole('button', { name: 'Vorlagenaufgabe hinzufügen' }).click();
    await dialog.getByLabel('Aufgabentitel').nth(index).fill(title);
    await dialog
      .getByLabel('Tage vor der Aktion')
      .nth(index)
      .fill(String(10 - index));
  }
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Zeltlager');
  await expect(dialog.getByLabel('Aufgabentitel').first()).toHaveValue('Zelte prüfen');
  const leftOver = dialog.getByRole('region', { name: 'Noch nicht eingesetzt' });
  await expect(leftOver).toContainText('Einkauf planen');
  await expect(leftOver).toContainText('Bus buchen');
  await expect(
    dialog.getByText('Den Rest findest du im Abschnitt „Noch nicht eingesetzt“.')
  ).toBeVisible();

  // A second new login before the rows are added keeps them too
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Zeltlager');
  await expect(leftOver).toContainText('Einkauf planen');
  await expect(leftOver).toContainText('Bus buchen');

  await dialog.getByRole('button', { name: 'Vorlagenaufgabe hinzufügen' }).click();
  await dialog.getByRole('button', { name: 'Vorlagenaufgabe hinzufügen' }).click();
  await expect(dialog.getByLabel('Aufgabentitel')).toHaveCount(3);
  await expect(dialog.getByLabel('Aufgabentitel').nth(1)).toHaveValue('Einkauf planen');
  await expect(dialog.getByLabel('Aufgabentitel').nth(2)).toHaveValue('Bus buchen');
  await expect(dialog.getByLabel('Tage vor der Aktion').nth(2)).toHaveValue('8');
  await expect(leftOver).toHaveCount(0);

  // Saved once the login works: the kept input is gone
  await page.unroute('**/api/intern/pflege/aufgaben/vorlagen');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Deine Eingaben sind gesichert' })).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem('phoenix:gerettete-eingaben:v1'))
  ).toBeNull();
});

test('in the iPhone app an adopted calendar entry comes back with its own Stufen', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/**', (route) =>
    route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 401 })
  );
  await page.goto('/leitendenbereich/aktionen');
  const publish = page.getByRole('button', {
    name: 'Im öffentlichen Kalender veröffentlichen: Sommerlager 2026 Oberjoch',
  });
  const dialog = page.getByRole('dialog');
  const stufen = (): Promise<boolean[]> =>
    dialog
      .getByRole('checkbox')
      .evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).checked));
  await publish.click();
  // Adopting the entry replaces the Stufen chosen before with its own
  await dialog
    .getByLabel(/Vorhandenen Kalendereintrag/)
    .selectOption({ label: 'Roverrunde: Kochabend (20.10.2026)' });
  const before = await stufen();
  await dialog
    .getByRole('button', { name: /Veröffentlichen|Speichern/ })
    .last()
    .click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await publish.click();
  await expect(dialog.getByLabel(/Vorhandenen Kalendereintrag/)).toHaveValue(/.+/);
  await expect(dialog.getByText('wieder eingesetzt. Prüf sie und speichere.')).toBeVisible();
  expect(await stufen()).toEqual(before);
});

test('in the iPhone app a CampFlow link waits for the list of Aktionen', async ({ page }) => {
  await page.request.post('/api/__mock/aufgaben/reset');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/aufgaben/projekte', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aufgaben/projekte');
  const dialog = page.getByRole('dialog', { name: 'Projekt' });
  await page.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  await dialog.getByLabel('Titel', { exact: true }).fill('Sola vorbereiten');
  const link = dialog.getByLabel('CampFlow-Aktion');
  await link.selectOption({ index: 1 });
  const chosen = await link.inputValue();
  expect(chosen).not.toBe('');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  // After the new login the list of Aktionen arrives only after the dialog opened
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/aktionen', async (route) => {
    await held;
    await route.fallback();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Sola vorbereiten');
  await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toBeVisible();
  // Another login while the option is still missing must retain the waiting selection.
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Projekt anlegen', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toBeVisible();
  release();
  await expect(link).toHaveValue(chosen);
  await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toHaveCount(0);
});

test('in the iPhone app two tasks with the same values keep their own input', async ({ page }) => {
  await page.request.post('/api/__mock/aufgaben/reset');
  for (let i = 0; i < 2; i++) {
    const created = await page.request.post('/api/intern/pflege/aufgaben', {
      data: {
        title: 'Zelte zählen',
        description: '',
        assignee: '',
        dueDate: null,
        projectId: null,
      },
    });
    expect(created.ok()).toBe(true);
  }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.route('**/api/intern/pflege/aufgaben/*', (route) =>
    route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 401 })
  );
  await page.goto('/leitendenbereich/aufgaben');
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  const tasks = page.getByRole('button', { name: 'Zelte zählen', exact: true });
  await tasks.first().click();
  await dialog.getByLabel('Titel', { exact: true }).fill('Zelte zählen und flicken');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  // Same title, same values when opened: only the record tells them apart
  await tasks.last().click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Zelte zählen');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await tasks.first().click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Zelte zählen und flicken');
});

test('in the iPhone app saving a template with rows still missing ends the kept input', async ({
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
  const dialog = page.getByRole('dialog', { name: 'Vorlage' });
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await dialog.getByLabel('Titel', { exact: true }).fill('Hüttenwochenende');
  await dialog.getByLabel('Aufgabentitel').fill('Hütte buchen');
  await dialog.getByLabel('Tage vor der Aktion').fill('30');
  await dialog.getByRole('button', { name: 'Vorlagenaufgabe hinzufügen' }).click();
  await dialog.getByLabel('Aufgabentitel').nth(1).fill('Schlüssel holen');
  await dialog.getByLabel('Tage vor der Aktion').nth(1).fill('1');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toBeVisible();
  // Saved with only the first row: the template dialog is removed, not closed
  await page.unroute('**/api/intern/pflege/aufgaben/vorlagen');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Deine Eingaben sind gesichert' })).toHaveCount(0);
});

test('in the iPhone app discarding a template with rows still missing ends the kept input', async ({
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
  const dialog = page.getByRole('dialog', { name: 'Vorlage' });
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await dialog.getByLabel('Titel', { exact: true }).fill('Hüttenwochenende');
  await dialog.getByLabel('Aufgabentitel').fill('Hütte buchen');
  await dialog.getByLabel('Tage vor der Aktion').fill('30');
  await dialog.getByRole('button', { name: 'Vorlagenaufgabe hinzufügen' }).click();
  await dialog.getByLabel('Aufgabentitel').nth(1).fill('Schlüssel holen');
  await dialog.getByLabel('Tage vor der Aktion').nth(1).fill('1');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Vorlage anlegen' }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Deine Eingaben sind gesichert' })).toHaveCount(0);
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

test('in the iPhone app the photo of a receipt opens through the login of the new window', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: /REWE/ }).first().click();
  const [, login] = await Promise.all([
    context.waitForEvent('page'),
    context.waitForEvent('request', (request) => request.url().includes('/.auth/login/aad')),
    page.getByRole('link', { name: 'Foto des Belegs von REWE' }).click(),
  ]);
  expect(new URL(login.url()).searchParams.get('post_login_redirect_uri')).toMatch(
    /^\/api\/intern\/pflege\/belege\/[^/]+\/foto\?v=/
  );
});

test('in the iPhone app a newer FAQ answer is preserved and the earlier draft stays accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await page.request.post('/api/intern/pflege/qa', {
    data: {
      question: 'Recovery conflict question',
      answer: '<p>Original answer</p>',
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
  await expect(
    dialog.getByText('Dieser Eintrag wurde inzwischen geändert.', { exact: false })
  ).toBeVisible();
  await page.unroute(`**/api/intern/pflege/qa/${id}`);
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
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

async function conflictingQuestion(page: Page, title: string, answer: string): Promise<string> {
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await page.request.post('/api/intern/pflege/qa', {
    data: { question: title, answer, category: 'Allgemein', published: true },
  });
  const { id } = await created.json();
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route(`**/api/intern/pflege/qa/${id}`, (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/fragen-und-antworten');
  await page.getByRole('button', { name: `Bearbeiten: ${title}`, exact: true }).click();
  return id;
}

async function returnToConflictingQuestion(page: Page, id: string, title: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Frage bearbeiten', exact: true });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  // APIRequestContext bypasses page routes, like a write by another person.
  expect(
    (
      await page.request.patch(`/api/intern/pflege/qa/${id}`, {
        data: { answer: '<p>Newer answer</p>' },
      })
    ).ok()
  ).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: `Bearbeiten: ${title}`, exact: true }).click();
}

test('in the iPhone app a conflicting draft shows cleared fields and removed check marks', async ({
  page,
}) => {
  const title = 'Recovery cleared fields';
  const id = await conflictingQuestion(page, title, '<p>Original answer</p>');
  const dialog = page.getByRole('dialog', { name: 'Frage bearbeiten', exact: true });
  await dialog.getByRole('checkbox', { name: /Veröffentlicht/ }).uncheck();
  await dialog.getByLabel('Frage', { exact: true }).fill('');
  const answer = dialog.getByRole('textbox', { name: 'Antwort', exact: true });
  await answer.fill('');
  // Required fields can be cleared without submitting: trigger the expired session via
  // a valid question first, then clear it while the login link is already shown.
  await dialog.getByLabel('Frage', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByLabel('Frage', { exact: true }).fill('');
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await page.request.patch(`/api/intern/pflege/qa/${id}`, {
    data: { answer: '<p>Newer answer</p>' },
  });
  await page.reload();
  await page.getByRole('button', { name: `Bearbeiten: ${title}`, exact: true }).click();
  await expect(answer).toContainText('Newer answer');
  await expect(dialog.getByRole('checkbox', { name: /Veröffentlicht/ })).toBeChecked();
  const draft = dialog.getByRole('region', { name: 'Noch nicht eingesetzt' });
  await expect(
    draft.getByRole('listitem').filter({ has: page.getByText('Status', { exact: true }) })
  ).toContainText('nicht angehakt');
  for (const label of ['Frage', 'Antwort']) {
    await expect(
      draft.getByRole('listitem').filter({ has: page.getByText(label, { exact: true }) })
    ).toContainText('Leer');
  }
  await page.request.delete(`/api/intern/pflege/qa/${id}`);
});

test('in the iPhone app copying a conflicting answer keeps its formatting and labelled link', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const title = 'Recovery formatted clipboard';
  const id = await conflictingQuestion(
    page,
    title,
    '<p>Siehe <strong>unbedingt</strong> die <a href="https://example.org/treffpunkt">Karte</a>.</p>'
  );
  const dialog = page.getByRole('dialog', { name: 'Frage bearbeiten', exact: true });
  await dialog.getByLabel('Frage', { exact: true }).fill('My unsaved question');
  await returnToConflictingQuestion(page, id, title);
  const draft = dialog.getByRole('region', { name: 'Noch nicht eingesetzt' });
  await expect(draft.getByRole('link', { name: 'Karte' })).toHaveAttribute(
    'href',
    'https://example.org/treffpunkt'
  );
  await expect(draft).not.toContainText('<p>');
  await draft.getByRole('button', { name: 'Antwort kopieren', exact: true }).click();
  await expect(draft.getByText('Kopiert.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Siehe unbedingt die Karte.'
  );
  const answer = dialog.getByRole('textbox', { name: 'Antwort', exact: true });
  await answer.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(answer.locator('strong')).toHaveText('unbedingt');
  await expect(answer.getByRole('link', { name: 'Karte' })).toHaveAttribute(
    'href',
    'https://example.org/treffpunkt'
  );
  await expect(answer).not.toContainText('<p>');
  await page.request.delete(`/api/intern/pflege/qa/${id}`);
});

for (const action of ['upload', 'remove'] as const) {
  test(`in the iPhone app a confirmed photo ${action} preserves recovery of unsaved fields`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const name = `Photo recovery ${action}`;
    const created = await page.request.post('/api/intern/pflege/leitende', {
      data: { name, teams: [] },
    });
    const { id } = await created.json();
    if (action === 'remove') {
      await page.request.put(`/api/intern/pflege/leitende/${id}/foto`, {
        headers: { 'Content-Type': 'image/jpeg' },
        data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      });
    }
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await page.route(`**/api/intern/pflege/leitende/${id}`, (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
    );
    await page.goto('/leitendenbereich/leitende');
    await page.getByRole('button', { name: new RegExp(name) }).click();
    const dialog = page.getByRole('dialog', { name: /Photo/ });
    // The version advances, but these unsaved values must not become the new baseline.
    await dialog.getByLabel('Name', { exact: true }).fill(`Photo unsaved before ${action}`);
    if (action === 'remove') {
      await dialog.getByRole('button', { name: 'Foto entfernen', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Foto entfernen?', exact: true })
        .getByRole('button', { name: 'Entfernen', exact: true })
        .click();
    } else {
      const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 10;
        canvas.height = 10;
        return canvas.toDataURL('image/png').split(',')[1];
      });
      await dialog.locator('input[type="file"]').setInputFiles({
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
      });
    }
    await expect(
      dialog.getByText(action === 'remove' ? 'Foto entfernt.' : 'Foto gespeichert.', {
        exact: true,
      })
    ).toBeVisible();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(
      `Photo unsaved before ${action}`
    );
    await dialog.getByLabel('Name', { exact: true }).fill(`Photo recovered ${action}`);
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(
      `Photo recovered ${action}`
    );
    await expect(
      dialog.getByText('wieder eingesetzt. Prüf sie und speichere.', { exact: false })
    ).toBeVisible();
    await page.request.delete(`/api/intern/pflege/leitende/${id}`);
  });
}

test('in the iPhone app adopting a changed calendar entry keeps its newer description', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const data = {
    title: 'Recovery adoption',
    start: '2026-10-22',
    end: '',
    link: '',
    stufen: ['Rover'],
    description: '<p>Original adoption text</p>',
    campflowId: null,
  };
  const created = await page.request.post('/api/intern/pflege/aktionen', { data });
  const { id } = await created.json();
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route(`**/api/intern/pflege/aktionen/${id}`, (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aktionen');
  const publish = page.getByRole('button', {
    name: 'Im öffentlichen Kalender veröffentlichen: Sommerlager 2026 Oberjoch',
  });
  await publish.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Vorhandenen Kalendereintrag/).selectOption(id);
  await expect(dialog.getByRole('textbox', { name: 'Beschreibung' })).toContainText(
    'Original adoption text'
  );
  await dialog.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await page.request.patch(`/api/intern/pflege/aktionen/${id}`, {
    data: { ...data, description: '<p>Newer adoption text</p>' },
  });
  await page.reload();
  await publish.click();
  await expect(
    dialog.getByText('Dieser Eintrag wurde inzwischen geändert.', { exact: false })
  ).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toContainText(
    'Original adoption text'
  );
  await dialog.getByLabel(/Vorhandenen Kalendereintrag/).selectOption(id);
  await expect(dialog.getByRole('textbox', { name: 'Beschreibung' })).toContainText(
    'Newer adoption text'
  );
  await page.unroute(`**/api/intern/pflege/aktionen/${id}`);
  const write = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/aktionen/${id}`)
  );
  await dialog.getByRole('button', { name: 'Veröffentlichen', exact: true }).click();
  expect((await write).postDataJSON().description).toContain('Newer adoption text');
  await expect(dialog).toBeHidden();
  await page.request.delete(`/api/intern/pflege/aktionen/${id}`);
});

test('in the iPhone app removed template rows and their remaining assignees are recovered exactly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/__mock/aufgaben/reset');
  await page.request.post('/api/intern/pflege/aufgaben/vorlagen', {
    data: {
      title: 'Recovery row removal',
      items: ['A', 'B', 'C'].map((title) => ({
        title,
        description: title + ' description',
        assignee: '',
        assignees: [],
        daysBefore: 14,
      })),
    },
  });
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route('**/api/intern/pflege/aufgaben/vorlagen/*', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aufgaben/vorlagen');
  const open = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Recovery row removal', exact: true }) })
    .getByRole('button', { name: 'Vorlage bearbeiten' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage' });
  await dialog.getByRole('button', { name: 'Vorlagenaufgabe entfernen' }).first().click();
  await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).first().fill('Bea');
  await dialog.getByRole('option', { name: 'Bea Beispiel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await open.click();
  await expect(dialog.getByLabel('Aufgabentitel')).toHaveCount(2);
  await expect(dialog.getByLabel('Aufgabentitel').nth(0)).toHaveValue('B');
  await expect(dialog.getByLabel('Aufgabentitel').nth(1)).toHaveValue('C');
  await expect(
    dialog.getByRole('button', { name: 'Bea Beispiel entfernen', exact: true })
  ).toHaveCount(1);
  await page.unroute('**/api/intern/pflege/aufgaben/vorlagen/*');
  const write = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().includes('/aufgaben/vorlagen/')
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  const saved = (await write).postDataJSON();
  expect(saved.items.map((item: { title: string }) => item.title)).toEqual(['B', 'C']);
  expect(saved.items[0].assignees).toEqual([{ name: 'Bea Beispiel', login: 'bea@example.test' }]);
  expect(saved.items[1].assignees).toEqual([]);
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
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
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
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
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
    canvas.width = 400;
    canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 400, 600);
    context.fillStyle = '#fff';
    context.fillRect(60, 60, 280, 480);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  });
  await expect(dialog.getByAltText('Vorschau des Scans')).toBeVisible();
  await dialog.getByRole('button', { name: /Ecke oben links verschieben/ }).press('ArrowLeft');
  const checkNotice = dialog.getByRole('note').filter({ hasText: warning });
  await expect(checkNotice.getByRole('link', { name: 'Neu anmelden', exact: true })).toBeVisible();
  await expect(checkNotice).toContainText('Wähle das Foto nach der neuen Anmeldung erneut aus');
  await dialog.getByLabel('Geschäft').fill('Recovery receipt photo');
  await dialog.getByLabel('Betrag in €').fill('12,34');
  await dialog.getByLabel('Aktion', { exact: true }).fill('Wölflings-Herbstwochenende');
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
  await expect(dialog.getByAltText('Vorschau des Scans')).toHaveCount(0);
  await expect(dialog.getByText(warning, { exact: false })).toHaveCount(0);
});

test('in the iPhone app a saved receipt photo no longer needs a warning and keeps later recovery', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route('**/api/intern/pflege/belege/*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/belege');
  const open = page.getByRole('button', { name: /REWE/ }).first();
  await open.click();
  const dialog = page.getByRole('dialog', { name: /Beleg von/ });
  await dialog.getByLabel('Geschäft').fill('REWE recovery after photo');
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 400, 600);
    context.fillStyle = '#fff';
    context.fillRect(60, 60, 280, 480);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  });
  await dialog.getByRole('button', { name: 'Neues Foto speichern', exact: true }).click();
  await expect(dialog.getByText('Foto ersetzt.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  const error = dialog.getByRole('alert');
  await expect(error).not.toContainText('sein Zuschnitt werden nicht gesichert');
  await error.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await open.click();
  await expect(dialog.getByLabel('Geschäft')).toHaveValue('REWE recovery after photo');
  await expect(
    dialog.getByText('wieder eingesetzt. Prüf sie und speichere.', { exact: false })
  ).toBeVisible();
});

for (const keep of ['positiveTags', 'negativeTags'] as const) {
  test(`in the iPhone app helper wishes recover ${keep} and cleared opposite wishes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const data = await (await page.request.get('/api/intern/nikolaus/helfende')).json();
    const person = data.persons.find((entry: { name: string }) => entry.name === 'Katharina Huber');
    await page.request.patch(`/api/intern/pflege/nikolaus-helfende/${person.id}`, {
      data: {
        ...person,
        positiveTags: ['Old preferred'],
        negativeTags: ['Old restriction'],
      },
    });
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await page.route(`**/api/intern/pflege/nikolaus-helfende/${person.id}`, (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 401 }) : route.fallback()
    );
    await page.goto('/leitendenbereich/nikolaus-helfende?ansicht=helfende');
    const open = page.getByRole('button', { name: /^Bearbeiten.*Katharina Huber/ });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Person bearbeiten', exact: true });
    for (const tag of ['Old preferred', 'Old restriction']) {
      await dialog.getByRole('button', { name: `${tag} entfernen`, exact: true }).click();
    }
    const label = keep === 'positiveTags' ? 'Bevorzugt zu Familien mit' : 'Nicht zu Familien mit';
    await dialog.getByLabel(label, { exact: false }).fill('Recovery wish');
    await dialog.getByLabel(label, { exact: false }).press('Enter');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
    await open.click();
    await expect(
      dialog.getByRole('button', { name: 'Recovery wish entfernen', exact: true })
    ).toBeVisible();
    for (const tag of ['Old preferred', 'Old restriction']) {
      await expect(
        dialog.getByRole('button', { name: `${tag} entfernen`, exact: true })
      ).toHaveCount(0);
    }
    await page.unroute(`**/api/intern/pflege/nikolaus-helfende/${person.id}`);
    const write = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' && request.url().endsWith(`/nikolaus-helfende/${person.id}`)
    );
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    const saved = (await write).postDataJSON();
    expect(saved.positiveTags).toEqual(keep === 'positiveTags' ? ['Recovery wish'] : []);
    expect(saved.negativeTags).toEqual(keep === 'negativeTags' ? ['Recovery wish'] : []);
    await expect(dialog).toBeHidden();
    await page.request.patch(`/api/intern/pflege/nikolaus-helfende/${person.id}`, { data: person });
  });
}

test('in the iPhone app a long conflicting answer leaves fields and save accessible on a phone', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const title = 'Recovery long answer';
  const html = Array.from(
    { length: 30 },
    (_, index) =>
      `<p>Geretteter Absatz ${index}: Dieser längere Text soll sich lesen und kopieren lassen.</p>`
  ).join('');
  const id = await conflictingQuestion(page, title, html);
  const dialog = page.getByRole('dialog', { name: 'Frage bearbeiten', exact: true });
  await dialog.getByLabel('Frage', { exact: true }).fill('My earlier question');
  await returnToConflictingQuestion(page, id, title);
  await expect(dialog.getByLabel('Frage', { exact: true })).toBeInViewport();
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
  await expect(save).toBeInViewport();
  const copy = dialog
    .getByRole('region', { name: 'Noch nicht eingesetzt' })
    .getByRole('button', { name: 'Antwort kopieren', exact: true });
  await copy.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await copy.click();
  const answer = dialog.getByRole('textbox', { name: 'Antwort', exact: true });
  await answer.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(answer).toContainText('Geretteter Absatz 29');
  await dialog.getByLabel('Frage', { exact: true }).fill('Manually reviewed question');
  await expect(dialog.getByLabel('Frage', { exact: true })).toBeInViewport();
  await expect(save).toBeInViewport();
  await page.request.delete(`/api/intern/pflege/qa/${id}`);
});

test('in the iPhone app many missing template rows leave copying and adding rows accessible', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.request.post('/api/__mock/aufgaben/reset');
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.route('**/api/intern/pflege/aufgaben/vorlagen', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aufgaben/vorlagen');
  const open = page.getByRole('button', { name: 'Vorlage anlegen' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage' });
  await dialog.getByLabel('Titel', { exact: true }).fill('Recovery long template');
  const add = dialog.getByRole('button', { name: 'Vorlagenaufgabe hinzufügen', exact: true });
  for (let index = 0; index < 8; index++) {
    if (index) await add.click();
    await dialog.getByLabel('Aufgabentitel').nth(index).fill(`Gerettete Aufgabe ${index}`);
    await dialog.getByLabel('Tage vor der Aktion').nth(index).fill('14');
  }
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
  await save.click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await open.click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toBeInViewport();
  await expect(save).toBeInViewport();
  const copy = dialog
    .getByRole('region', { name: 'Noch nicht eingesetzt' })
    .getByRole('button', { name: 'Aufgabentitel kopieren', exact: true })
    .first();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Gerettete Aufgabe 1');
  await expect(save).toBeInViewport();
  await add.click();
  await expect(dialog.getByLabel('Aufgabentitel').nth(1)).toHaveValue('Gerettete Aufgabe 1');
  await dialog.getByLabel('Aufgabentitel').nth(1).fill('Aufgabe überarbeitet');
  await expect(save).toBeInViewport();
});

test('in the iPhone app a delayed directory does not turn an unchanged task into a recovery conflict', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/__mock/aufgaben/reset');
  const login = 'lena.brandstaetter@stamm-phoenix.de';
  await page.request.post('/api/intern/pflege/aufgaben', {
    data: {
      title: 'Recovery delayed directory',
      description: '',
      assignee: login,
      dueDate: null,
      projectId: null,
    },
  });
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  let hold = false;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/pflege/aufgaben/benutzer', async (route) => {
    if (hold) await held;
    await route.fulfill({
      json: { users: [{ name: 'Lena Brandstätter', login }], unavailable: false },
    });
  });
  await page.route('**/api/intern/pflege/aufgaben/*', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401 }) : route.fallback()
  );
  await page.goto('/leitendenbereich/aufgaben');
  const open = page.getByRole('button', { name: 'Recovery delayed directory', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Lena Brandstätter entfernen', exact: true })
  ).toBeVisible();
  await dialog.getByLabel('Titel', { exact: true }).fill('Recovered with directory still loading');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  hold = true;
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
  await open.click();
  // The unchanged task initially derives "Lena Brandstaetter" without the directory.
  // That presentation difference must not block recovery or change the selected identity.
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue(
    'Recovered with directory still loading'
  );
  await expect(
    dialog.getByText('wieder eingesetzt. Prüf sie und speichere.', { exact: false })
  ).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Lena Brandstätter entfernen', exact: true })
  ).toBeVisible();
  release();
  await expect(dialog.getByText('Personenvorschläge werden geladen …')).toHaveCount(0);
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue(
    'Recovered with directory still loading'
  );
});

for (const module of ['task', 'template'] as const) {
  for (const names of [['Alex Beispiel'], ['Alex Beispiel', 'Bea Beispiel']]) {
    test(`in the iPhone app conflicting ${module} assignees can adopt ${names.length} saved identities`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.request.post('/api/__mock/aufgaben/reset');
      const title = `Manual recovery ${module} ${names.length}`;
      const base = '/api/intern/pflege/aufgaben';
      const endpoint = module === 'task' ? base : `${base}/vorlagen`;
      const initialItem = {
        title: 'Template item',
        description: 'Original description',
        assignee: '',
        assignees: [],
        daysBefore: 14,
      };
      await page.request.post(endpoint, {
        data:
          module === 'task'
            ? {
                title,
                description: 'Original description',
                assignee: '',
                assignees: [],
                dueDate: null,
                projectId: null,
              }
            : { title, items: [initialItem] },
      });
      const overview = await (await page.request.get(base)).json();
      const original = (module === 'task' ? overview.tasks : overview.templates).find(
        (entry: { title: string }) => entry.title === title
      );
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'standalone', { value: true })
      );
      await page.route(`**${endpoint}/${original.id}`, (route) =>
        route.request().method() === 'PUT' ? route.fulfill({ status: 401 }) : route.fallback()
      );
      await page.goto(
        module === 'task' ? '/leitendenbereich/aufgaben' : '/leitendenbereich/aufgaben/vorlagen'
      );
      const open =
        module === 'task'
          ? page.getByRole('button', { name: title, exact: true })
          : page
              .getByRole('listitem')
              .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
              .getByRole('button', { name: 'Vorlage bearbeiten', exact: true });
      await open.click();
      const dialog = page.getByRole('dialog', {
        name: module === 'task' ? 'Aufgabe bearbeiten' : 'Vorlage',
        exact: true,
      });
      for (const name of names) {
        await dialog.getByRole('combobox', { name: 'Zuständigkeit', exact: false }).fill(name);
        await dialog.getByRole('option', { name, exact: true }).click();
      }
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
      const newer =
        module === 'task'
          ? { ...original, description: 'Newer server description', done: false }
          : { ...original, items: [{ ...initialItem, description: 'Newer server description' }] };
      expect((await page.request.put(`${endpoint}/${original.id}`, { data: newer })).ok()).toBe(
        true
      );
      await page.reload();
      await open.click();
      const kept = dialog.getByRole('region', { name: 'Noch nicht eingesetzt' });
      const label = module === 'task' ? 'Zuständige' : 'Aufgabe 1: Zuständige';
      await expect(
        kept.getByRole('button', { name: `${label} kopieren`, exact: true })
      ).toHaveCount(0);
      await kept.getByRole('button', { name: `${label} übernehmen`, exact: true }).click();
      for (const name of names) {
        await expect(
          dialog.getByRole('button', { name: `${name} entfernen`, exact: true })
        ).toBeVisible();
      }
      await expect(dialog.getByText(`${label} übernommen.`, { exact: false })).toBeVisible();
      await expect(dialog.getByLabel('Beschreibung', { exact: false })).toHaveValue(
        'Newer server description'
      );
      await page.unroute(`**${endpoint}/${original.id}`);
      const write = page.waitForRequest(
        (request) =>
          request.method() === 'PUT' &&
          request.url().endsWith(`${endpoint.slice(4)}/${original.id}`)
      );
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      const body = (await write).postDataJSON();
      const saved = module === 'task' ? body : body.items[0];
      expect(saved.assignees).toEqual(
        names.map((name) => ({
          name,
          login: name.startsWith('Alex') ? 'alex@example.test' : 'bea@example.test',
        }))
      );
      expect(saved.description).toBe('Newer server description');
      await expect(dialog).toBeHidden();
    });
  }
}

for (const changed of [false, true]) {
  test(`in the iPhone app late article prices ${changed ? 'still detect a changed order' : 'do not block recovery of an unchanged order'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const base = '/api/intern/pflege/sammelbestellungen';
    const source = await (await page.request.get(`${base}/101`)).json();
    const original = source.orders.find((entry: { name: string }) => entry.name === 'Mia Bauer');
    const reference = 'https://www.ruesthaus.de/987654/recovery-delayed-price';
    let expired = true;
    let saved = false;
    let hold = false;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let priceStarted: () => void = () => {};
    const waitingForPrice = new Promise<void>((resolve) => (priceStarted = resolve));
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await page.route(`**${base}/101`, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const order = data.orders.find((entry: { id: string }) => entry.id === original.id);
      if (!saved) order.totalCents = null;
      order.items = [
        { ...order.items[0], reference, name: 'Recovery article', quantity: 1, excluded: null },
      ];
      await route.fulfill({ response, json: data });
    });
    await page.route(`**${base}/product`, async (route) => {
      if (route.request().postDataJSON().reference !== reference) return route.fallback();
      if (hold) {
        priceStarted();
        await held;
      }
      await route.fulfill({
        json: {
          sourceUrl: reference,
          name: 'Recovery article',
          unitPriceCents: 4500,
          availability: 'available',
          imageUrl: null,
        },
      });
    });
    await page.route(`**${base}/orders/${original.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      if (expired) return route.fulfill({ status: 401 });
      const response = await route.fetch();
      saved = response.ok();
      await route.fulfill({ response });
    });
    await page.goto('/leitendenbereich/sammelbestellungen/101');
    const row = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Mia Bauer', exact: true }) });
    await expect(row.getByText('45,00 €', { exact: true }).first()).toBeVisible();
    const open = row.getByRole('button', { name: 'Status bearbeiten', exact: true });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Bestellstatus bearbeiten', exact: true });
    const total = dialog.getByLabel('Endgültiger Gesamtbetrag in Euro');
    await expect(total).toHaveValue('45');
    await total.fill('42');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    hold = true;
    if (changed) {
      expect(
        (
          await page.request.patch(`${base}/orders/${original.id}`, {
            data: {
              etag: original.etag,
              status: original.status,
              paid: original.paid,
              delivered: !original.delivered,
              totalCents: null,
            },
          })
        ).ok()
      ).toBe(true);
    }
    await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();
    await waitingForPrice;
    await open.click();
    if (changed) {
      await expect(total).toHaveValue('');
      await expect(
        dialog.getByText('Dieser Eintrag wurde inzwischen geändert.', { exact: false })
      ).toBeVisible();
      await expect(dialog.getByRole('region', { name: 'Noch nicht eingesetzt' })).toContainText(
        '42'
      );
      release();
    } else {
      await expect(total).toHaveValue('42');
      await expect(
        dialog.getByText('wieder eingesetzt. Prüf sie und speichere.', { exact: false })
      ).toBeVisible();
      release();
      await expect(row.getByText('45,00 €', { exact: true }).first()).toBeVisible();
      await expect(total).toHaveValue('42');
      expired = false;
      const write = page.waitForRequest(
        (request) =>
          request.method() === 'PATCH' &&
          request.url().endsWith(`/sammelbestellungen/orders/${original.id}`)
      );
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      expect((await write).postDataJSON().totalCents).toBe(4200);
      await expect(dialog).toBeHidden();
    }
    const current = await (await page.request.get(`${base}/101`)).json();
    const etag = current.orders.find((entry: { id: string }) => entry.id === original.id).etag;
    await page.request.patch(`${base}/orders/${original.id}`, { data: { ...original, etag } });
  });
}
