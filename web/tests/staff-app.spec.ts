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

  await expect(dialog.getByRole('alert')).toContainText('setzt es deine Eingaben selbst ein');
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
  await expect(dialog.getByText('Den Rest findest du darunter.')).toBeVisible();

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
