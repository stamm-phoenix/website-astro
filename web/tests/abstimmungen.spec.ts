import { expect, test } from './fixtures';

test('a leader creates an Abstimmung, invites, and a guest votes over the shared link', async ({
  page,
  browser,
}) => {
  // The whole flow of the module, with two pages and mails sent in several requests
  test.setTimeout(60_000);
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('button', { name: 'Abstimmung anlegen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Abstimmung' });
  await dialog.getByRole('textbox', { name: 'Frage' }).fill('Wann ist die nächste Leiterrunde?');
  await dialog.getByLabel('Datum', { exact: true }).fill('2026-11-14');
  await dialog.getByLabel('Uhrzeit (optional)').fill('18:00');
  await dialog.getByRole('button', { name: 'Termin hinzufügen' }).click();
  await dialog.getByLabel('Datum', { exact: true }).fill('2026-11-21');
  await dialog.getByRole('button', { name: 'Termin hinzufügen' }).click();
  await expect(dialog.getByLabel('Option 1', { exact: true })).toHaveValue(
    'Sa, 14.11.2026, 18:00 Uhr'
  );
  await expect(dialog.getByLabel('Option 2', { exact: true })).toHaveValue('Sa, 21.11.2026');
  await dialog.getByRole('button', { name: 'Abstimmung anlegen' }).click();

  await expect(
    page.getByRole('heading', { name: 'Wann ist die nächste Leiterrunde?' })
  ).toBeVisible();
  await page.getByLabel('Sa, 14.11.2026, 18:00 Uhr').check();
  await page.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(page.getByText('Antwort gespeichert.').first()).toBeVisible();
  await expect(page.getByText('Du hast abgestimmt')).toBeVisible();

  await page.getByRole('button', { name: 'Per Mail einladen' }).click();
  await page
    .getByRole('dialog', { name: 'Zur Abstimmung einladen' })
    .getByRole('button', { name: /Personen einladen$/ })
    .click();
  // The mails go out a few per request
  await expect(page.getByText('Einladungen verschickt.').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Eingeladen: \d+, davon 0 abgestimmt$/)).toBeVisible();

  const shared = await page.getByText(/\/abstimmung#link=/).textContent();
  const guest = await browser.newPage();
  await guest.goto(shared!.trim());
  await guest.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(guest.getByText('Bitte gib deinen Namen ein.')).toBeVisible();
  await guest.getByLabel('Dein Name').fill('Oma Erna');
  await guest.getByLabel('Sa, 21.11.2026').check();
  await guest.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(guest.getByText('Antwort gespeichert.').first()).toBeVisible();
  // The page switched to the personal link, so a reload keeps the answer
  await expect(guest).toHaveURL(/#t=/);
  await guest.reload();
  await expect(guest.getByLabel('Dein Name')).toHaveValue('Oma Erna');
  await expect(guest.getByLabel('Sa, 21.11.2026')).toBeChecked();
  await guest.close();

  await page.getByRole('button', { name: 'Abstimmung beenden' }).click();
  await page
    .getByRole('dialog', { name: /beenden\?$/ })
    .getByRole('button', { name: 'Abstimmung beenden' })
    .click();
  await expect(page.getByText('Abstimmung beendet.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wieder öffnen' })).toBeVisible();
  await expect(page.getByText('Oma Erna')).toBeVisible();
});

test('an Abstimmung of someone else can be answered but not managed', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('link', { name: /Termin für die Weihnachtsfeier/ }).click();
  await expect(page.getByRole('heading', { name: 'Termin für die Weihnachtsfeier' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Per Mail einladen' })).toHaveCount(0);
  await page.getByLabel('Fr, 18.12.2026, 19:00 Uhr').check();
  await page.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(page.getByText('Antwort gespeichert.').first()).toBeVisible();
});

test('emptying an option with votes warns that its votes are lost', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('link', { name: /Was essen wir auf dem Sommerlager/ }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Abstimmung bearbeiten' });
  await dialog.getByLabel('Option 3', { exact: true }).fill('');
  await expect(
    dialog.getByText('Beim Speichern gehen die Stimmen für „Kässpatzn“ verloren.')
  ).toBeVisible();
});

test('an unanswered link can be reloaded without a question', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  const list = (await (await page.request.get('/api/intern/pflege/abstimmungen')).json()) as {
    id: number;
    eigene: boolean;
  }[];
  const own = list.find((entry) => entry.eigene)!;
  const detail = (await (
    await page.request.get(`/api/intern/pflege/abstimmungen/${own.id}`)
  ).json()) as { link: string };
  let asked = false;
  page.on('dialog', async (dialog) => {
    asked = true;
    await dialog.accept();
  });
  await page.goto(new URL(detail.link).pathname + new URL(detail.link).hash);
  await expect(page.getByLabel('Dein Name')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Dein Name')).toBeVisible();
  expect(asked).toBe(false);
});

test('reloading keeps an unsaved answer', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('link', { name: /Termin für die Weihnachtsfeier/ }).click();
  await page.getByLabel('Sa, 12.12.2026, 18:00 Uhr').check();
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByText('Noch nicht gespeichert')).toBeVisible();
  await expect(page.getByLabel('Sa, 12.12.2026, 18:00 Uhr')).toBeChecked();
});

test('after a conflict the current version replaces the form', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('link', { name: /Was essen wir auf dem Sommerlager/ }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Abstimmung bearbeiten' });
  await dialog.getByRole('textbox', { name: 'Frage' }).fill('Mein alter Stand');
  // Meanwhile someone else saves a new title in another tab
  const id = new URL(page.url()).searchParams.get('id');
  const current = (await (
    await page.request.get(`/api/intern/pflege/abstimmungen/${id}`)
  ).json()) as {
    etag: string;
    optionen: { id: number; text: string }[];
  };
  await page.request.patch(`/api/intern/pflege/abstimmungen/${id}`, {
    data: {
      etag: current.etag,
      titel: 'Neuer Titel aus dem anderen Tab',
      beschreibung: '',
      mehrfach: false,
      optionen: current.optionen.map(({ id: optionId, text }) => ({ id: optionId, text })),
    },
  });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await dialog.getByRole('button', { name: 'Aktuelle Fassung laden' }).click();
  await page
    .getByRole('dialog', { name: 'Aktuelle Fassung laden?' })
    .getByRole('button', { name: 'Neu laden' })
    .click();
  await expect(dialog.getByRole('textbox', { name: 'Frage' })).toHaveValue(
    'Neuer Titel aus dem anderen Tab'
  );
});

test('another link in the same tab opens that Abstimmung', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  const list = (await (await page.request.get('/api/intern/pflege/abstimmungen')).json()) as {
    id: number;
    titel: string;
  }[];
  const essen = list.find((entry) => entry.titel.startsWith('Was essen'))!;
  const { link } = (await (
    await page.request.get(`/api/intern/pflege/abstimmungen/${essen.id}`)
  ).json()) as { link: string };
  const first = new URL(link);
  // A personal link of the other Abstimmung, from an answer over its shared link
  await page.goto(`${first.pathname}${first.hash}`);
  await page.getByLabel('Dein Name').fill('Oma Erna');
  await page.getByLabel('Spaghetti').check();
  await page.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(page.getByText('Antwort gespeichert.').first()).toBeVisible();
  const own = new URL(page.url()).hash;

  await page.evaluate(() => {
    window.location.hash = 'link=' + 'x'.repeat(43);
  });
  await expect(page.getByText(/Dieser Link ist ungültig/)).toBeVisible();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, own);
  await expect(page.getByLabel('Dein Name')).toHaveValue('Oma Erna');
  await expect(page.getByLabel('Spaghetti')).toBeChecked();
});

test('after a new login in the iPhone app the options keep their votes', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  let expired = true;
  await page.route('**/api/intern/pflege/abstimmungen/*', (route) =>
    expired && route.request().method() === 'PATCH'
      ? route.fulfill({ status: 401 })
      : route.fallback()
  );
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('link', { name: /Was essen wir auf dem Sommerlager/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Was essen wir auf dem Sommerlager?' })
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get('id');
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Abstimmung bearbeiten' });
  // Spaghetti goes, Pizza comes; Kässpatzn has a vote
  await dialog.getByRole('button', { name: /^Option 1 entfernen/ }).click();
  await dialog.getByRole('button', { name: 'Option hinzufügen' }).click();
  await dialog.getByLabel('Option 3', { exact: true }).fill('Pizza');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await dialog.getByRole('link', { name: 'Neu anmelden', exact: true }).click();

  expired = false;
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  await expect(dialog.getByLabel('Option 1', { exact: true })).toHaveValue('Chili sin Carne');
  await expect(dialog.getByLabel('Option 2', { exact: true })).toHaveValue('Kässpatzn');
  await expect(dialog.getByLabel('Option 3', { exact: true })).toHaveValue('Pizza');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  const detail = (await (
    await page.request.get(`/api/intern/pflege/abstimmungen/${id}`)
  ).json()) as {
    optionen: { text: string; stimmen: number }[];
  };
  expect(detail.optionen.map((option) => [option.text, option.stimmen])).toEqual([
    ['Chili sin Carne', 0],
    ['Kässpatzn', 1],
    ['Pizza', 0],
  ]);
});

test('a late save of the link before does not take the page back', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  const list = (await (await page.request.get('/api/intern/pflege/abstimmungen')).json()) as {
    id: number;
    titel: string;
  }[];
  const essen = list.find((entry) => entry.titel.startsWith('Was essen'))!;
  const { link } = (await (
    await page.request.get(`/api/intern/pflege/abstimmungen/${essen.id}`)
  ).json()) as { link: string };
  let answer: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route('**/api/abstimmungen/stimme', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(new URL(link).pathname + new URL(link).hash);
  await page.getByLabel('Dein Name').fill('Oma Erna');
  await page.getByLabel('Spaghetti').check();
  await page.getByRole('button', { name: /Antwort speichern|Wird gespeichert/ }).click();
  // Meanwhile another link is opened in the same tab
  await page.evaluate(() => {
    window.location.hash = 'link=' + 'x'.repeat(43);
  });
  await page
    .getByRole('dialog', { name: 'Anderen Link öffnen?' })
    .getByRole('button', { name: 'Anderen Link öffnen' })
    .click();
  await expect(page.getByText(/Dieser Link ist ungültig/)).toBeVisible();
  answer();
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).hash).toBe('#link=' + 'x'.repeat(43));
  await expect(page.getByText(/Dieser Link ist ungültig/)).toBeVisible();
});
