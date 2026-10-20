import { test, expect } from './fixtures';
import { prepareTaskTest, taskStatus } from './aufgaben-helpers';
test.beforeEach(async ({ page }, info) => prepareTaskTest(page, info.project.name));

test('conflict reload confirms replacement and saves the fresh version', async ({ page }) => {
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Küche vorbereiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await dialog.getByLabel('Titel', { exact: true }).fill('Mein Entwurf');
  let conflict = true;
  const freshEtag = '"0000000000000999"';
  await page.route('**/api/intern/pflege/aufgaben/1', async (route) => {
    if (conflict) return route.fulfill({ status: 409, json: { message: 'Bitte neu laden.' } });
    expect(route.request().postDataJSON().etag).toBe(freshEtag);
    const overview = await page.request.get('/api/intern/pflege/aufgaben');
    const task = (await overview.json()).tasks.find((item: { id: number }) => item.id === 1);
    return route.fulfill({ json: { ...task, title: 'Aktuelle Fassung', etag: freshEtag } });
  });
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await dialog.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Aktuelle Fassung laden?' });
  await confirmation.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Mein Entwurf');
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tasks = data.tasks.map((item: { id: number }) =>
      item.id === 1 ? { ...item, title: 'Aktuelle Fassung', etag: freshEtag } : item
    );
    await route.fulfill({ response, json: data });
  });
  await dialog.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(dialog.getByLabel('Titel', { exact: true })).toHaveValue('Aktuelle Fassung');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Aktuelle Fassung', exact: true }).click();
  conflict = false;
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await expect(dialog).not.toBeVisible();
});

test('field errors clear on editing and dialog focus returns to the card', async ({ page }) => {
  await page.goto('/leitendenbereich/aufgaben');
  const opener = page.getByRole('button', { name: 'Küche vorbereiten', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  const title = dialog.getByLabel('Titel', { exact: true });
  await title.fill('');
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await title.fill('Korrigiert');
  await expect(title).not.toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Änderungen verwerfen?' })
    .getByRole('button', { name: 'Änderungen verwerfen', exact: true })
    .click();
  await expect(opener).toBeFocused();
  await taskStatus(page, 'Alle');
  const row = page.locator('#aufgabe-1');
  await row.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Wieder öffnen', exact: true })).toBeFocused();
});

for (const area of ['projekte', 'vorlagen', 'vorschlaege']) {
  test(`${area} has loading, German non-JSON error and retry`, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/intern/pflege/aufgaben', async (route) => {
      await pending;
      await route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad Gateway' });
    });
    await page.goto(`/leitendenbereich/aufgaben/${area}`);
    await expect(page.getByText('Aufgabenbereich wird geladen …', { exact: true })).toBeVisible();
    release();
    // Without a message from the server the module says what failed and whom to ask
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Die Aufgaben konnten nicht geladen oder gespeichert werden.' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toBeVisible();
    await expect(page.getByText('API error:', { exact: false })).toHaveCount(0);
    await page.unroute('**/api/intern/pflege/aufgaben');
    await page.getByRole('button', { name: 'Neu laden', exact: true }).click();
    await expect(
      page.getByText('Aufgabenbereich wird geladen …', { exact: true })
    ).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Neu laden', exact: true })).toHaveCount(0);
  });
}

test('permission-limited directory is visible as configuration error', async ({ page }) => {
  await page.route('**/api/intern/pflege/aufgaben/benutzer', (route) =>
    route.fulfill({ json: { users: [], unavailable: true, configurationError: true } })
  );
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  await expect(
    page.getByText('Die Personenliste ist nicht vollständig eingerichtet.', { exact: false })
  ).toBeVisible();
});

test('reject conflicts show one error and retry with the reloaded version', async ({ page }) => {
  let remaining = true;
  let etag = '"old-proposal"';
  let attempts = 0;
  await page.route('**/api/intern/pflege/aufgaben', async (route) => {
    const response = await route.fetch();
    const overview = await response.json();
    await route.fulfill({
      response,
      json: {
        ...overview,
        tasks: remaining
          ? [
              {
                id: 900,
                etag,
                title: 'Konfliktvorschlag',
                description: '',
                assignee: '',
                dueDate: null,
                projectId: null,
                state: 'vorschlag',
                sourceId: 'mock-protocol',
                sourceVersion: 'v1',
                quote: 'Material prüfen.',
              },
            ]
          : [],
      },
    });
  });
  await page.route('**/api/intern/pflege/aufgaben/900/entscheidung', async (route) => {
    expect(route.request().postDataJSON().etag).toBe(etag);
    if (++attempts === 1) {
      etag = '"fresh-proposal"';
      return route.fulfill({ status: 409, json: { message: 'Bitte neu laden.' } });
    }
    remaining = false;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/leitendenbereich/aufgaben/vorschlaege');
  const row = page.locator('#aufgabe-900');
  await row.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Vorschlag „.+“ ablehnen\?$/ });
  await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('field errors follow the field name when its DOM id changes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Küche vorbereiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  const title = dialog.getByLabel('Titel', { exact: true });
  await title.fill('');
  await dialog
    .getByRole('button', {
      name: /^(?:Speichern|Aufgabe anlegen|Aufgabe speichern|Person hinzufügen|Person speichern)$/,
    })
    .click();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await title.evaluate((input) => {
    const label = document.querySelector(`label[for="${input.id}"]`);
    input.id = 'renamed-task-title';
    label?.setAttribute('for', input.id);
  });
  await dialog.getByLabel('Titel', { exact: true }).fill('Korrigierter Titel');
  await expect(dialog.getByLabel('Titel', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: `/tmp/278-task-field-${info.project.name}.png` });
});

test('date and assignee placeholders retain readable contrast in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const placeholder of ['TT.MM.JJJJ', 'Person hinzufügen …']) {
      const field = page.getByPlaceholder(placeholder, { exact: true });
      const contrast = await field.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const pixel = (color: string): number[] => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        let parent: Element | null = element;
        let background = [255, 255, 255, 255];
        while (parent) {
          const candidate = pixel(getComputedStyle(parent).backgroundColor);
          if (candidate[3] === 255) {
            background = candidate;
            break;
          }
          parent = parent.parentElement;
        }
        const style = getComputedStyle(element, '::placeholder');
        const foreground = pixel(style.color);
        const alpha = (foreground[3] / 255) * Number(style.opacity);
        const blended = foreground
          .slice(0, 3)
          .map((value, index) => value * alpha + background[index] * (1 - alpha));
        const luminance = (color: number[]): number =>
          color
            .slice(0, 3)
            .map((value) => {
              const normalized = value / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const a = luminance(blended),
          b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast, `${placeholder} in ${colorScheme}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({
      path: `/tmp/278-task-placeholder-${colorScheme}-${test.info().project.name}.png`,
    });
  }
});
