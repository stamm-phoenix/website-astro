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
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
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
  conflict = false;
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('field errors clear on editing and dialog focus returns to the card', async ({ page }) => {
  await page.goto('/leitendenbereich/aufgaben');
  const opener = page.getByRole('button', { name: 'Küche vorbereiten', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  const title = dialog.getByLabel('Titel', { exact: true });
  await title.fill('');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
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
    await expect(
      page.getByRole('alert').filter({ hasText: 'Bitte erneut versuchen.' })
    ).toBeVisible();
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
