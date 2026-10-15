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
    await dialog.getByRole('checkbox', { name: /Veröffentlicht/ }).check();
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Bitte eine Antwort angeben.')).toBeVisible();

    await dialog.getByRole('checkbox', { name: /Veröffentlicht/ }).uncheck();
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
    await expect(alert.getByRole('link', { name: 'it@stamm-phoenix.de' })).toHaveAttribute(
      'href',
      'mailto:it@stamm-phoenix.de'
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
    await expect(page.getByText('Als Entwurf gespeichert.').first()).toBeVisible();
    await expect(page).toHaveURL(/\?id=/);
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeVisible();

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
