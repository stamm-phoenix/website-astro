import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'dark' : 'light' });
});

test('participant errors name their fields and clear while correcting them', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26?tab=teilnehmende');
  const form = page.getByRole('region', { name: 'Person nachtragen' });
  await form.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(form.getByLabel('Nachname', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await form.getByLabel('Vorname', { exact: true }).fill('Neue Person');
  await expect(form.getByLabel('Nachname', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await form.getByLabel(/^Alter(?: \(optional\))?$/).fill('x');
  await form.getByLabel(/^PLZ(?: \(optional\))?$/).fill('123');
  await form.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(form.getByLabel(/^Alter(?: \(optional\))?$/)).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(form.getByLabel(/^PLZ(?: \(optional\))?$/)).toHaveAttribute('aria-invalid', 'true');
  await form.getByLabel(/^Alter(?: \(optional\))?$/).fill('21');
  await form.getByLabel(/^PLZ(?: \(optional\))?$/).fill('83043');
  await expect(form.getByLabel(/^Alter(?: \(optional\))?$/)).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(form.getByLabel(/^PLZ(?: \(optional\))?$/)).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.screenshot({ path: `/tmp/278-participant-fields-${test.info().project.name}.png` });
  await form.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(page.getByRole('status').getByText(/Neue Person wurde nachgetragen/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const mode of ['status', 'item']) {
  test(`staff ${mode} conflict keeps the draft until confirmed reload`, async ({ page }) => {
    let saves = 0;
    const endpoint =
      mode === 'status'
        ? '**/api/intern/pflege/sammelbestellungen/orders/*'
        : '**/api/intern/pflege/sammelbestellungen/orders/*/item';
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      saves++;
      await route.fulfill({
        status: 409,
        json: { code: 'CONFLICT', message: 'Die Bestellung wurde inzwischen geändert.' },
      });
    });
    await page.goto('/leitendenbereich/sammelbestellungen/101');
    const row = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Mia Bauer', exact: true }) });
    await row
      .getByRole('button', {
        name: mode === 'status' ? 'Status bearbeiten' : 'Nicht mitbestellen',
        exact: true,
      })
      .first()
      .click();
    const editor = page.getByRole('dialog', {
      name: mode === 'status' ? 'Bestellstatus bearbeiten' : 'Artikel ausschließen',
      exact: true,
    });
    const input =
      mode === 'status'
        ? editor.getByLabel('Endgültiger Gesamtbetrag in Euro')
        : editor.getByLabel('Kommentar');
    const draft = mode === 'status' ? '12.34' : 'Mein ungespeicherter Kommentar';
    await input.fill(draft);
    await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(input).toHaveValue(draft);
    await expect(editor.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Aktuelle Fassung laden?', exact: true });
    await confirmation.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
    await expect(input).toHaveValue(draft);
    await editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Neu laden', exact: true }).click();
    await expect(input).not.toHaveValue(draft);
    await expect(editor.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
    expect(saves).toBe(1);
    await page.screenshot({ path: `/tmp/278-sammel-${mode}-${test.info().project.name}.png` });
    await expectNoHorizontalOverflow(page);
  });
}

test('a conflict reload waits for new item prices before prefilling the total', async ({
  page,
}) => {
  const reference = 'https://www.ruesthaus.de/987654/review-neuer-artikel';
  let conflicted = false;
  let releasePrice: () => void = () => {};
  const pendingPrice = new Promise<void>((resolve) => {
    releasePrice = resolve;
  });
  let priceStarted: () => void = () => {};
  const waitingForPrice = new Promise<void>((resolve) => {
    priceStarted = resolve;
  });
  await page.route('**/api/intern/pflege/sammelbestellungen/101', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (conflicted) {
      const order = data.orders.find((item: { name: string }) => item.name === 'Mia Bauer');
      order.etag = 'current-item-price-version';
      order.totalCents = null;
      order.items = [
        { ...order.items[0], reference, name: 'Neuer Shopartikel', quantity: 1, excluded: null },
      ];
    }
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/intern/pflege/sammelbestellungen/product', async (route) => {
    if (route.request().postDataJSON().reference !== reference) return route.continue();
    priceStarted();
    await pendingPrice;
    await route.fulfill({
      json: {
        sourceUrl: reference,
        name: 'Neuer Shopartikel',
        unitPriceCents: 2500,
        availability: 'available',
        imageUrl: null,
      },
    });
  });
  await page.route('**/api/intern/pflege/sammelbestellungen/orders/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    conflicted = true;
    await route.fulfill({
      status: 409,
      json: { code: 'CONFLICT', message: 'Die Bestellung wurde inzwischen geändert.' },
    });
  });
  await page.goto('/leitendenbereich/sammelbestellungen/101');
  const row = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Mia Bauer', exact: true }) });
  await row.getByRole('button', { name: 'Status bearbeiten', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Bestellstatus bearbeiten', exact: true });
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Aktuelle Fassung laden?', exact: true })
    .getByRole('button', { name: 'Neu laden', exact: true })
    .click();
  await waitingForPrice;
  releasePrice();
  await expect(editor.getByLabel('Endgültiger Gesamtbetrag in Euro')).toHaveValue('25');
  await expect(editor.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  await page.screenshot({ path: `/tmp/278-sammel-current-price-${test.info().project.name}.png` });
  await expectNoHorizontalOverflow(page);
});
