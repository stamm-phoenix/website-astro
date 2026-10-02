import { test, expect, navigate, expectNoHorizontalOverflow } from './fixtures';

test('navigation and skip link work with a keyboard at both widths', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const menu = page.getByRole('button', { name: 'Menü öffnen', exact: true });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#menu-btn')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu-btn')).toHaveAttribute('aria-expanded', 'false');
  }
  await navigate(page, 'Gruppenstunden');
  await expect(page).toHaveURL(/\/gruppenstunden\/?$/);
  await expect(page.getByRole('heading', { name: /Gruppenstunden/, level: 1 })).toBeVisible();
  await expect(page.getByText('Wölflinge', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('membership embed initializes again after Astro navigation', async ({ page }) => {
  await page.goto('/mitmachen');
  await expect(page.getByTitle('Mitgliedsantrag')).toHaveCount(1);
  await page.frameLocator('iframe[title^="Mitgliedsantrag"]').getByLabel('Vorname').fill('Demo');
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).navigationMarker = 'same-document';
  });
  await navigate(page, 'Kontakt');
  await expect(page).toHaveURL(/\/kontakt\/?$/);
  await navigate(page, 'Mitmachen');
  await expect(page).toHaveURL(/\/mitmachen\/?$/);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).navigationMarker)
  ).toBe('same-document');
  await expect(page.getByTitle('Mitgliedsantrag')).toHaveCount(1);
  await expect(
    page.frameLocator('iframe[title^="Mitgliedsantrag"]').getByLabel('Vorname')
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('booking management saves contact details and survives reload', async ({ page }, testInfo) => {
  await page.goto('/nikolaus/termin?token=mock');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const phone = testInfo.project.name === 'mobile' ? '+49 170 1234568' : '+49 170 1234567';
  await page.getByLabel('Telefon (möglichst Handynummer)').fill(phone);
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(page.getByText(/Ihre Angaben wurden gespeichert/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Telefon (möglichst Handynummer)')).toHaveValue(phone);
  await expectNoHorizontalOverflow(page);
});

test('invalid and inactive booking links cannot confirm a visit', async ({ page, request }) => {
  await page.goto('/nikolaus/termin?token=unknown');
  await expect(page.getByRole('heading', { name: 'Buchung nicht gefunden' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Dieser Link ist ungültig oder abgelaufen.');
  const invalid = await request.post('/api/nikolaus/manage/lookup', { data: { token: '' } });
  expect(invalid.status()).toBe(404);
  for (const [token, heading, code] of [
    ['storniert', 'Der Termin wurde abgesagt', 'CANCELLED'],
    ['abgelaufen', 'Die Reservierung ist abgelaufen', 'EXPIRED'],
  ]) {
    await page.goto(`/nikolaus/termin?token=${token}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Termin verbindlich bestätigen' })).toHaveCount(
      0
    );
    const confirm = await request.post('/api/nikolaus/manage/confirm', { data: { token } });
    expect(confirm.status()).toBe(410);
    expect((await confirm.json()).code).toBe(code);
  }
  await expectNoHorizontalOverflow(page);
});

test('stale order save reports a conflict and retains the draft', async ({
  page,
  request,
}, testInfo) => {
  await page.goto('/mitgliederbereich/sammelbestellungen#kind=order&id=2001&token=mock');
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  const draft = `Mein ungespeicherter Entwurf ${testInfo.project.name}`;
  await page.getByLabel('Name', { exact: true }).fill(draft);
  // A second actor updates the same fixture, producing a real stale ETag response.
  const response = await request.post('/api/sammelbestellungen/order', {
    data: { id: '2001', token: 'mock' },
  });
  expect(response.headers()['x-mock-api']).toBe('1');
  const view = await response.json();
  const changed = await request.patch('/api/intern/pflege/sammelbestellungen/orders/2001', {
    data: { etag: view.order.etag, status: 'Eingereicht', paid: false, delivered: false },
  });
  expect(changed.status()).toBe(204);
  const saveResponse = page.waitForResponse(
    (res) => res.url().endsWith('/api/sammelbestellungen/order') && res.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  expect((await saveResponse).status()).toBe(409);
  await expect(page.getByText(/wurde inzwischen geändert/)).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(draft);
  await page.getByRole('button', { name: 'Bestellung neu laden' }).click();
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue(draft);
  await expectNoHorizontalOverflow(page);
});

test('group order saves member changes and loads staff detail routes', async ({
  page,
}, testInfo) => {
  await page.goto('/mitgliederbereich/sammelbestellungen#kind=order&id=2002&token=mock');
  await expect(page.getByRole('button', { name: 'Gespeichert', exact: true })).toBeDisabled();
  const note = `Demo-Bestellung ${testInfo.project.name}`;
  await page.getByLabel('Bemerkungen', { exact: false }).fill(note);
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(page.getByText(/Deine Bestellung wurde gespeichert/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Bemerkungen', { exact: false })).toHaveValue(note);
  await expectNoHorizontalOverflow(page);
  await page.goto('/leitendenbereich/sammelbestellungen/101');
  await expect(
    page.getByRole('heading', { name: 'Kluft & Halstücher Herbst 2026', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Mia Bauer', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a receipt is submitted with a photo and checked by the Kassenteam', async ({
  page,
}, testInfo) => {
  await page.goto('/leitendenbereich/belege');
  await expect(page.getByText('REWE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).click();

  // A photo of a slightly turned receipt on a dark table, drawn in the browser
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3a3027';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(600, 800);
    context.rotate(0.08);
    context.fillStyle = '#f4f1ea';
    context.fillRect(-350, -600, 700, 1200);
    context.fillStyle = '#222';
    context.font = '36px sans-serif';
    for (let line = 0; line < 22; line++)
      context.fillText(`Artikel ${line}   1,99 EUR`, -300, -540 + line * 52);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'beleg.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) });
  await expect(page.getByAltText('Vorschau des Scans')).toBeVisible();
  await expect(page.getByText(/Ränder erkannt/)).toBeVisible();
  // Corners can be moved with the keyboard as well
  await page.getByRole('button', { name: /Ecke oben links verschieben/ }).press('ArrowLeft');
  await expect(page.getByAltText('Vorschau des Scans')).toBeVisible();
  await expect(page.getByText(/KI-Vorprüfung: Der Beleg ist vollständig/)).toBeVisible();
  await expect(page.getByLabel('Geschäft')).toHaveValue('Demo-Markt');
  await expect(page.getByLabel('Betrag in €')).toHaveValue('9,99');

  const shop = `Testmarkt ${testInfo.project.name}`;
  await page.getByLabel('Geschäft').fill(shop);
  await page.getByLabel('Betrag in €').fill('12,34');
  await page.getByLabel('Aktion', { exact: true }).fill('Herbstlager 2026');
  await page.getByRole('button', { name: 'Einreichen', exact: true }).click();
  await expect(page.getByText(/über 12,34\s€ eingereicht/)).toBeVisible();
  await expect(page.getByText(shop, { exact: true })).toBeVisible();

  const card = page.getByRole('button', { name: new RegExp(shop) });
  await card.click();
  await expect(page.getByText(/Eingereicht von leitung@example\.test/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Original ansehen' })).toBeVisible();
  await page.getByRole('radio', { name: 'Geprüft' }).check();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText(`Beleg von ${shop} gespeichert.`)).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: /^Geprüft/ }).click();
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
