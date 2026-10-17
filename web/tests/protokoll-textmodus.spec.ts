import { test, expect } from './fixtures';

// The choice between the formatting editor and the Markdown field is saved per person (#320).

test.beforeEach(async ({ page }) => {
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
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();
  await expect(region.locator('textarea')).toHaveCount(0);

  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Markdown' }).click();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toHaveCount(0);
  // Saved on the server: another load, as on another device, starts with Markdown
  await expect
    .poll(async () => await (await page.request.get('/api/intern/einstellungen')).json())
    .toEqual({ settings: { protokollText: 'markdown' } });
  await page.reload();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(modus.getByRole('button', { name: 'Markdown' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('a choice that cannot be saved still applies to the open page and says so', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Wahl ohne Server');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();

  await page.route('**/api/intern/einstellungen', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: {} }) : route.fallback()
  );
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown' })
    .click();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'nicht gespeichert' })).toBeVisible();
});

test('two quick switches keep the last choice, also when the first save answers late', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde zweimal umgeschaltet');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();

  // The save of "Markdown" takes long; the save of "Formatiert" must still come after it
  await page.route('**/api/intern/einstellungen', async (route) => {
    const request = route.request();
    if (
      request.method() === 'PUT' &&
      request.postDataJSON().settings.protokollText === 'markdown'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.fallback();
  });
  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Markdown' }).click();
  await modus.getByRole('button', { name: 'Formatiert' }).click();
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();
  await expect
    .poll(async () => await (await page.request.get('/api/intern/einstellungen')).json(), {
      timeout: 5000,
    })
    .toEqual({ settings: { protokollText: 'formatiert' } });
  await page.waitForTimeout(300);
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();
  await expect(modus.getByRole('button', { name: 'Formatiert' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('a choice made while the settings still load is not taken back by their late answer', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde späte Antwort');
  // The settings answer late, the minutes are shown before
  await page.route('**/api/intern/einstellungen', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    await route.fallback();
  });
  const answered = page.waitForResponse(
    (response) =>
      response.url().includes('/api/intern/einstellungen') && response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  // The minutes are shown for reading while the settings are still on their way
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();
  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Markdown' }).click();
  await expect(region.locator('textarea')).toHaveCount(1);

  await answered;
  await page.waitForTimeout(300);
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(modus.getByRole('button', { name: 'Markdown' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('a choice made on another device applies when the editor opens again over internal links', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde anderes Gerät');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { samePage: boolean }).samePage = true;
  });

  // Another device chooses Markdown
  await page.request.put('/api/intern/einstellungen', {
    data: { settings: { protokollText: 'markdown' } },
  });
  await page
    .getByRole('navigation', { name: 'Brotkrümelnavigation' })
    .getByRole('link', { name: 'Protokolle' })
    .click();
  await expect(page.getByRole('heading', { name: 'Im Editor' })).toBeVisible();
  await page.getByRole('link', { name: 'Leitendenrunde anderes Gerät' }).click();
  await expect(page.getByRole('heading', { name: 'Kopfdaten' })).toBeVisible();
  // The links kept the page script alive, as the site's router does
  expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(
    true
  );
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(
    page
      .getByRole('group', { name: 'Texte schreiben als' })
      .getByRole('button', { name: 'Markdown' })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('after an expired login the hint offers to log in again and the choice stays', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Anmeldung abgelaufen');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();

  await page.route('**/api/intern/einstellungen', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 401, json: {} }) : route.fallback()
  );
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown' })
    .click();
  await expect(region.locator('textarea')).toHaveCount(1);
  const hint = page.getByRole('status').filter({ hasText: 'Anmeldung ist abgelaufen' });
  await expect(hint).toBeVisible();
  await expect(hint.getByRole('link', { name: /Neu anmelden/ })).toBeVisible();
});
