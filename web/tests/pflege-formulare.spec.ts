import { test, expect, answerConfirm } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

// Every test works on its own entries, so the demo data other tests rely on stays in place.
const marker = (): string => `TEST – bitte löschen ${test.info().project.name}`;

async function createGruppenstunde(request: APIRequestContext, location: string): Promise<string> {
  const response = await request.post('/api/intern/pflege/gruppenstunden', {
    data: { stufe: 'Rover', weekday: 'Montags', time: '19:00 Uhr - 21:00 Uhr', location },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

test.describe('Gruppenstunden', () => {
  test('saving checks the fields and stores a changed entry', async ({ page }) => {
    const location = marker();
    const id = await createGruppenstunde(page.request, location);
    await page.goto('/leitendenbereich/gruppenstunden');
    const entry = page.getByRole('listitem').filter({ hasText: location });
    await entry.getByRole('button', { name: /^Bearbeiten/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Rover bearbeiten' });

    // An empty place is refused without a request
    await dialog.getByLabel('Ort').fill('');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Bitte einen Ort angeben.')).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Ort').fill(`${location} geändert`);
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Gruppenstunde Rover gespeichert.').first()).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: `${location} geändert` })
    ).toHaveCount(1);

    await page.request.delete(`/api/intern/pflege/gruppenstunden/${id}`);
  });

  test('a conflict keeps the input in the dialog', async ({ page }) => {
    const location = marker();
    const id = await createGruppenstunde(page.request, location);
    await page.route(`**/api/intern/pflege/gruppenstunden/${id}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 409,
            json: { code: 'CONFLICT', message: 'Der Eintrag wurde inzwischen geändert.' },
          })
        : route.fallback()
    );
    await page.goto('/leitendenbereich/gruppenstunden');
    await page
      .getByRole('listitem')
      .filter({ hasText: location })
      .getByRole('button', { name: /^Bearbeiten/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Rover bearbeiten' });
    await dialog.getByLabel('Alter').fill('16 bis 20 Jahre');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

    await expect(dialog.getByRole('alert')).toContainText('inzwischen geändert');
    await expect(dialog.getByLabel('Alter')).toHaveValue('16 bis 20 Jahre');

    // Loading the current version replaces the input after a confirmation
    await dialog.getByRole('button', { name: 'Aktuelle Fassung laden' }).click();
    await answerConfirm(page, 'Aktuelle Fassung laden?', 'Neu laden');
    await expect(dialog.getByLabel('Alter')).toHaveValue('');
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    await page.unroute(`**/api/intern/pflege/gruppenstunden/${id}`);
    await page.request.delete(`/api/intern/pflege/gruppenstunden/${id}`);
  });
});

test.describe('Expired login', () => {
  // The platform answers an expired login with a redirect to the Microsoft login; tests of the
  // API itself may also see a plain 401.
  for (const [kind, answer] of [
    ['a redirect to the login', { status: 302, headers: { Location: '/.auth/login/aad' } }],
    ['a 401', { status: 401, body: '' }],
  ] as const) {
    test(`saving after ${kind} keeps the input and offers a new login in a new tab`, async ({
      page,
    }) => {
      const location = marker();
      const id = await createGruppenstunde(page.request, location);
      await page.route(`**/api/intern/pflege/gruppenstunden/${id}`, (route) =>
        route.request().method() === 'PATCH' ? route.fulfill(answer) : route.fallback()
      );
      await page.goto('/leitendenbereich/gruppenstunden');
      await page
        .getByRole('listitem')
        .filter({ hasText: location })
        .getByRole('button', { name: /^Bearbeiten/ })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Rover bearbeiten' });
      await dialog.getByLabel('Alter').fill('16 bis 20 Jahre');
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

      await expect(dialog.getByRole('alert')).toContainText(
        'Deine Anmeldung ist abgelaufen. Deine Eingaben sind noch da.'
      );
      const login = dialog.getByRole('link', { name: 'Neu anmelden (öffnet neuen Tab)' });
      await expect(login).toHaveAttribute(
        'href',
        '/.auth/login/aad?post_login_redirect_uri=/leitendenbereich/wieder-angemeldet'
      );
      await expect(login).toHaveAttribute('target', '_blank');
      await expect(dialog.getByLabel('Alter')).toHaveValue('16 bis 20 Jahre');

      // After logging in again in the other tab, saving once more works
      await page.unroute(`**/api/intern/pflege/gruppenstunden/${id}`);
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.request.delete(`/api/intern/pflege/gruppenstunden/${id}`);
    });
  }

  test('the page after the new login says to save again in the other tab', async ({ page }) => {
    await page.goto('/leitendenbereich/wieder-angemeldet');
    await expect(page.getByRole('heading', { name: 'Wieder angemeldet', level: 1 })).toBeVisible();
    await expect(page.getByText('Schließe diesen Tab')).toContainText(
      'tippe im anderen Tab noch einmal auf „Speichern“'
    );
  });
});

test.describe('Fragen und Antworten', () => {
  test('a draft needs a question and is saved without being published', async ({ page }) => {
    const question = `${marker()}?`;
    await page.goto('/leitendenbereich/fragen-und-antworten');
    await page.getByRole('button', { name: 'Neue Frage', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Neue Frage' });

    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Bitte eine Frage angeben.')).toBeVisible();

    // Publishing also needs an answer
    await dialog.getByLabel('Frage', { exact: true }).fill(question);
    await dialog.getByRole('checkbox', { name: 'Auf der Website veröffentlichen' }).check();
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Bitte eine Antwort angeben.')).toBeVisible();

    await dialog.getByRole('checkbox', { name: 'Auf der Website veröffentlichen' }).uncheck();
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('Entwurf gespeichert. Die Frage ist nicht öffentlich sichtbar.').first()
    ).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: question });
    await expect(row).toContainText('Entwurf');

    const list = (await (await page.request.get('/api/intern/pflege/qa')).json()) as {
      items: { id: string; question: string }[];
    };
    const created = list.items.find((item) => item.question === question);
    expect(created).toBeDefined();
    await page.request.delete(`/api/intern/pflege/qa/${created!.id}`);
  });

  test('a link in the answer is saved and can be followed in the public FAQ', async ({ page }) => {
    const question = `${marker()} Link?`;
    await page.goto('/leitendenbereich/fragen-und-antworten');
    await page.getByRole('button', { name: 'Neue Frage', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Neue Frage' });
    await dialog.getByLabel('Frage', { exact: true }).fill(question);

    const text = dialog.getByRole('textbox', { name: 'Antwort' });
    await text.click();
    await page.keyboard.type('Zur Packliste');
    await page.keyboard.press('Shift+Home');
    await dialog
      .getByRole('toolbar', { name: 'Formatierung' })
      .getByRole('button', { name: 'Link' })
      .click();
    await dialog.getByLabel('Linkadresse').fill('example.org/packliste');
    await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Auf der Website veröffentlichen' }).check();
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();

    const list = (await (await page.request.get('/api/intern/pflege/qa')).json()) as {
      items: { id: string; question: string; answer: string }[];
    };
    const created = list.items.find((item) => item.question === question);
    expect(created?.answer).toBe(
      '<p><a href="https://example.org/packliste">Zur Packliste</a></p>'
    );

    await page.goto('/fragen-und-antworten');
    await page.getByRole('button', { name: /Aktualisierte Fragen/ }).click();
    await page.getByRole('button', { name: question }).click();
    const link = page.getByRole('link', { name: 'Zur Packliste' });
    await expect(link).toHaveAttribute('href', 'https://example.org/packliste');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    await page.request.delete(`/api/intern/pflege/qa/${created!.id}`);
  });

  test('a server crash shows what failed, keeps the input and says whom to ask', async ({
    page,
  }) => {
    const question = `${marker()}?`;
    const response = await page.request.post('/api/intern/pflege/qa', {
      data: { question, answer: '', category: '', published: false },
    });
    const { id } = (await response.json()) as { id: string };
    await page.route(`**/api/intern/pflege/qa/${id}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, json: { error: 'Error', message: 'Internal Server Error' } })
        : route.fallback()
    );
    await page.goto('/leitendenbereich/fragen-und-antworten');
    await page.getByRole('button', { name: `Bearbeiten: ${question}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Frage bearbeiten' });
    await dialog.getByLabel('Frage', { exact: true }).fill(`${question} neu`);
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText(
      'Die Frage wurde nicht gespeichert. Deine Eingaben sind noch da. Tippe noch einmal auf „Speichern“.'
    );
    await expect(alert).not.toContainText('Internal Server Error');
    await expect(alert.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toHaveAttribute(
      'href',
      'mailto:admin@stamm-phoenix.de'
    );
    await expect(dialog.getByLabel('Frage', { exact: true })).toHaveValue(`${question} neu`);

    await page.unroute(`**/api/intern/pflege/qa/${id}`);
    await page.request.delete(`/api/intern/pflege/qa/${id}`);
  });

  test('a conflict keeps the input in the dialog', async ({ page }) => {
    const question = `${marker()}?`;
    const response = await page.request.post('/api/intern/pflege/qa', {
      data: { question, answer: '', category: '', published: false },
    });
    const { id } = (await response.json()) as { id: string };
    await page.route(`**/api/intern/pflege/qa/${id}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 409,
            json: { code: 'CONFLICT', message: 'Der Eintrag wurde inzwischen geändert.' },
          })
        : route.fallback()
    );
    await page.goto('/leitendenbereich/fragen-und-antworten');
    await page.getByRole('button', { name: `Bearbeiten: ${question}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Frage bearbeiten' });
    await dialog.getByLabel('Frage', { exact: true }).fill(`${question} neu`);
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

    await expect(dialog.getByRole('alert')).toContainText('inzwischen geändert');
    await expect(dialog.getByLabel('Frage', { exact: true })).toHaveValue(`${question} neu`);

    // A later check of the form replaces the old message
    await dialog.getByLabel('Frage', { exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Bitte eine Frage angeben.')).toBeVisible();
    await expect(dialog.getByText('inzwischen geändert')).toHaveCount(0);

    await page.unroute(`**/api/intern/pflege/qa/${id}`);
    await page.request.delete(`/api/intern/pflege/qa/${id}`);
  });
});

test.describe('Blog', () => {
  test('a new post needs a title and is created as a draft', async ({ page }) => {
    const title = marker();
    await page.goto('/leitendenbereich/blog/beitrag');
    const save = page.getByRole('button', { name: 'Als Entwurf anlegen', exact: true });

    await save.click();
    await expect(page.getByText('Bitte einen Titel angeben.')).toBeVisible();
    await expect(page).not.toHaveURL(/\?id=/);

    await page.getByLabel('Titel').fill(title);
    await save.click();
    await expect(
      page.getByText('Als Entwurf gespeichert.', { exact: false }).first()
    ).toBeVisible();
    await expect(page).toHaveURL(/\?id=/);
    await expect(
      page.getByRole('button', { name: 'Als Entwurf speichern', exact: true })
    ).toBeVisible();

    const id = new URL(page.url()).searchParams.get('id');
    await page.request.delete(`/api/intern/pflege/blog/${id}`);
  });
});

test.describe('Leitende', () => {
  test('a conflict on removing the photo offers the current version', async ({ page }) => {
    const name = marker();
    const created = await page.request.post('/api/intern/pflege/leitende', {
      data: { name, teams: [] },
    });
    const { id } = (await created.json()) as { id: string };
    await page.request.put(`/api/intern/pflege/leitende/${id}/foto`, {
      headers: { 'Content-Type': 'image/jpeg' },
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    await page.route(`**/api/intern/pflege/leitende/${id}/foto`, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 409,
            json: { code: 'CONFLICT', message: 'Der Eintrag wurde inzwischen geändert.' },
          })
        : route.fallback()
    );
    await page.goto('/leitendenbereich/leitende');
    await page.getByRole('button', { name: new RegExp(name) }).click();
    const dialog = page.getByRole('dialog', { name: `${name} bearbeiten` });
    await dialog.getByRole('button', { name: 'Foto entfernen' }).click();
    await answerConfirm(page, 'Foto entfernen?', 'Entfernen');

    await expect(dialog.getByRole('alert')).toContainText('inzwischen geändert');
    await expect(dialog.getByRole('button', { name: 'Aktuelle Fassung laden' })).toBeVisible();

    await page.unroute(`**/api/intern/pflege/leitende/${id}/foto`);
    await page.request.delete(`/api/intern/pflege/leitende/${id}`);
  });
});

test('an action conflict reload that fails keeps the description draft', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
  let failReload = false;
  await page.route('**/api/intern/pflege/aktionen', (route) =>
    failReload ? route.fulfill({ status: 503, body: 'unavailable' }) : route.fallback()
  );
  await page.route('**/api/intern/pflege/aktionen/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 409,
          json: { code: 'CONFLICT', message: 'Die Aktion wurde inzwischen geändert.' },
        })
      : route.fallback()
  );
  await page.goto('/leitendenbereich/aktionen?jahr=alle');
  await page
    .getByRole('button', { name: /^Kalendereintrag bearbeiten:/ })
    .first()
    .click();
  const editor = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('textbox', { name: 'Beschreibung' }) });
  await editor.getByRole('textbox', { name: 'Beschreibung' }).fill('Mein Beschreibungsentwurf');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(editor).toContainText(/wurde inzwischen geändert/);
  failReload = true;
  await editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Aktuelle Fassung laden?', exact: true })
    .getByRole('button', { name: 'Neu laden', exact: true })
    .click();
  await expect(editor.getByRole('textbox', { name: 'Beschreibung' })).toHaveText(
    'Mein Beschreibungsentwurf'
  );
  await expect(editor).toContainText('Deine Eingaben sind noch da.');
  await page.screenshot({ path: `/tmp/278-action-reload-${info.project.name}.png` });
});
