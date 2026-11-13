import { test, expect } from './fixtures';
import type { Request } from '@playwright/test';
import { settle } from './settle';

// The choice between the formatting editor and the Markdown field is saved per person (#320).

// The choice stays on the server of the worker, so every test starts from, and leaves, the default
test.beforeEach(async ({ page }) => {
  await page.request.post('/api/__mock/einstellungen/reset');
});
test.afterEach(async ({ page }) => {
  await page.request.post('/api/__mock/einstellungen/reset');
});

test('the formatting editor is the default and the choice of Markdown is kept on every device', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Voreinstellung');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible({ timeout: 15000 });
  await expect(region.locator('textarea')).toHaveCount(0);

  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Markdown je Punkt' }).click();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toHaveCount(0);
  // Saved on the server: another load, as on another device, starts with Markdown
  await expect
    .poll(async () => await (await page.request.get('/api/intern/einstellungen')).json())
    .toEqual({ settings: { protokollText: 'markdown' } });
  await page.reload();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(modus.getByRole('button', { name: 'Markdown je Punkt' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  // The whole agenda as one Markdown text (#613): a task line becomes a task of its item
  await modus.getByRole('button', { name: 'Ein Markdown-Text' }).click();
  const dokument = page.getByLabel('Tagesordnung als Markdown');
  const text = await dokument.inputValue();
  await dokument.fill(
    text.replace(
      '# Aktionsrückblick\n',
      '# Aktionsrückblick\n\nAufgabe: Zelte prüfen; bis: 20.11.2026\n'
    )
  );
  await modus.getByRole('button', { name: 'Markdown je Punkt' }).click();
  await expect(region.getByLabel('Aufgabe', { exact: true })).toHaveValue('Zelte prüfen');
});

test('a choice that cannot be saved still applies to the open page and says so', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Wahl ohne Server');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible({ timeout: 15000 });

  await page.route('**/api/intern/einstellungen', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: {} }) : route.fallback()
  );
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown je Punkt' })
    .click();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'nicht gespeichert' })).toBeVisible();
});

test('a saved choice that arrives late does not swap the field while the person types', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde späte Markdown-Wahl');
  // The person chose Markdown on another day; the settings answer late
  let late = true;
  await page.route('**/api/intern/einstellungen', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (late) await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({ json: { settings: { protokollText: 'markdown' } } });
  });
  const answered = page.waitForResponse(
    (response) =>
      response.url().includes('/api/intern/einstellungen') && response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  const text = region.locator('.punkt-text');
  await text.click();
  await page.keyboard.type('Erste Hilfe ');
  await answered;
  await page.keyboard.type('geübt');
  // The field stayed, with the focus and the text
  await expect(page.getByRole('textbox', { name: 'Tagesordnung' })).toBeFocused();
  await expect(text).toHaveText('Erste Hilfe geübt');
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible({ timeout: 15000 });
  await expect(region.locator('textarea')).toHaveCount(0);
  await expect(page.getByText(/^Gespeichert um/)).toBeVisible();
  // The saved choice applies at the next opening
  late = false;
  await page.reload();
  await expect(region.locator('textarea')).toHaveValue('Erste Hilfe geübt');
});

test('a choice made on another device applies when the editor opens again over internal links', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  // Desktop and phone may share one server, so the title names the project
  const title = `Leitendenrunde anderes Gerät (${test.info().project.name})`;
  await page.getByLabel('Titel').fill(title);
  // The settings of the first editor answer late, after the next editor has loaded its own
  let holding = true;
  const held: Array<() => void> = [];
  const heldRequests: Request[] = [];
  await page.route('**/api/intern/einstellungen', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && holding) {
      heldRequests.push(request);
      await new Promise<void>((resolve) => held.push(resolve));
      // Served before the other device chose, delivered late
      await route.fulfill({ json: { settings: {} } });
      return;
    }
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    (window as unknown as { samePage: boolean }).samePage = true;
  });

  // Another device chooses Markdown
  await page.request.put('/api/intern/einstellungen', {
    data: { settings: { protokollText: 'markdown' } },
  });
  await page
    .getByRole('navigation', { name: 'Zurück' })
    .getByRole('link', { name: 'Protokolle' })
    .click();
  await expect(page.getByRole('heading', { name: 'Im Editor' })).toBeVisible();
  holding = false;
  await page.getByRole('link', { name: title }).click();
  await page.getByText(/^Sitzungsdaten und Teilnehmende bearbeiten/).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();
  // The links kept the page script alive, as the site's router does
  expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(
    true
  );
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(
    page
      .getByRole('group', { name: 'Texte schreiben als' })
      .getByRole('button', { name: 'Markdown je Punkt' })
  ).toHaveAttribute('aria-pressed', 'true');
  // The late answers of the first editor, still with the old choice, do not take the new one back
  expect(heldRequests.length).toBeGreaterThan(0);
  const answers = Promise.all(
    heldRequests.map((request) =>
      page.waitForResponse((response) => response.request() === request)
    )
  );
  held.forEach((release) => release());
  await answers;
  await settle(page);
  await expect(region.locator('textarea')).toHaveCount(1);
});

test('a failed first switch leaves no hint once the next switch is saved', async ({ page }) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde erst Fehler dann gespeichert');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible({ timeout: 15000 });

  // The save of "Markdown" fails late; the save of "Formatiert" after it succeeds
  await page.route('**/api/intern/einstellungen', async (route) => {
    const request = route.request();
    if (
      request.method() === 'PUT' &&
      request.postDataJSON().settings.protokollText === 'markdown'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({ status: 500, json: {} });
      return;
    }
    await route.fallback();
  });
  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Markdown je Punkt' }).click();
  await modus.getByRole('button', { name: 'Formatiert' }).click();
  await expect
    .poll(async () => await (await page.request.get('/api/intern/einstellungen')).json(), {
      timeout: 5000,
    })
    .toEqual({ settings: { protokollText: 'formatiert' } });
  await settle(page);
  await expect(page.getByText('nicht gespeichert')).toHaveCount(0);
});

test('after an expired login the hint offers to log in again and the choice stays', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Anmeldung abgelaufen');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(page.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible({ timeout: 15000 });

  await page.route('**/api/intern/einstellungen', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401, json: {} }) : route.fallback()
  );
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown je Punkt' })
    .click();
  await expect(region.locator('textarea')).toHaveCount(1);
  const hint = page.getByRole('status').filter({ hasText: 'Anmeldung ist abgelaufen' });
  await expect(hint).toBeVisible();
  await expect(hint.getByRole('link', { name: /Neu anmelden/ })).toBeVisible();
});
