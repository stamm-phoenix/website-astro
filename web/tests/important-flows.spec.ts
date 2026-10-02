import { test, expect, navigate, expectNoHorizontalOverflow } from './fixtures';
import type { NikolausBookingInfo, StaffNikolausOverview } from '../src/lib/types';

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
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url());
  });
  await page.goto('/nikolaus/termin#token=mock');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const phone = testInfo.project.name === 'mobile' ? '+49 170 1234568' : '+49 170 1234567';
  await page.getByLabel('Telefon (möglichst Handynummer)').fill(phone);
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(page.getByText(/Ihre Angaben wurden gespeichert/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Telefon (möglichst Handynummer)')).toHaveValue(phone);
  expect(documents.length).toBeGreaterThanOrEqual(2);
  for (const document of documents) {
    expect(new URL(document).searchParams.has('token')).toBe(false);
    expect(document).not.toContain('mock');
  }
  await expectNoHorizontalOverflow(page);
});

test('legacy booking links migrate to a fragment and keep the same booking after a skip link and reload', async ({
  page,
}) => {
  const loaded = page.waitForResponse((response) =>
    response.url().endsWith('/api/nikolaus/manage/lookup')
  );
  await page.goto('/nikolaus/termin?token=mock');
  const original = (await (await loaded).json()) as NikolausBookingInfo;
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/nikolaus\/termin#token=mock$/);
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  const skip = page.getByRole('link', { name: 'Zum Inhalt springen' });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page).toHaveURL(/#main$/);
  const reloaded = page.waitForResponse((response) =>
    response.url().endsWith('/api/nikolaus/manage/lookup')
  );
  const document = page.waitForRequest((request) => request.resourceType() === 'document');
  await page.reload();
  const afterReload = (await (await reloaded).json()) as NikolausBookingInfo;
  expect(afterReload.familyName).toBe(original.familyName);
  expect(afterReload.slot).toEqual(original.slot);
  expect(afterReload.etag).toBe(original.etag);
  expect(new URL((await document).url()).searchParams.has('token')).toBe(false);
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Familienname')).toHaveValue(original.familyName);
  await expectNoHorizontalOverflow(page);
});

test('invalid and inactive booking links cannot confirm a visit', async ({ page, request }) => {
  await page.goto('/nikolaus/termin#token=unknown');
  await expect(page.getByRole('heading', { name: 'Buchung nicht gefunden' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Dieser Link ist ungültig oder abgelaufen.');
  const invalid = await request.post('/api/nikolaus/manage/lookup', { data: { token: '' } });
  expect(invalid.status()).toBe(404);
  for (const [token, heading, code] of [
    ['storniert', 'Der Termin wurde abgesagt', 'CANCELLED'],
    ['abgelaufen', 'Die Reservierung ist abgelaufen', 'EXPIRED'],
  ]) {
    const loaded = page.waitForResponse((response) =>
      response.url().endsWith('/api/nikolaus/manage/lookup')
    );
    await page.goto(`/nikolaus/termin#token=${token}`);
    const booking = (await (await loaded).json()) as NikolausBookingInfo;
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Termin verbindlich bestätigen' })).toHaveCount(
      0
    );
    const confirm = await request.post('/api/nikolaus/manage/confirm', {
      data: { token, etag: booking.etag },
    });
    expect(confirm.status()).toBe(410);
    expect((await confirm.json()).code).toBe(code);
  }
  await expectNoHorizontalOverflow(page);
});

test('a delayed response for the previous fragment token cannot replace the current booking', async ({
  page,
}) => {
  let requested: () => void = () => undefined;
  let release: () => void = () => undefined;
  const firstRequest = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/nikolaus/manage/lookup', async (route) => {
    const body = route.request().postDataJSON() as { token?: string };
    if (body.token !== 'mock') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    requested();
    await delay;
    await route.fulfill({ response });
  });
  await page.goto('/nikolaus/termin#token=mock');
  await firstRequest;
  await page.goto('/nikolaus/termin#token=storniert');
  await expect(
    page.getByRole('heading', { name: 'Der Termin wurde abgesagt', exact: true })
  ).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/nikolaus/manage/lookup') &&
      (response.request().postDataJSON() as { token?: string }).token === 'mock'
  );
  release();
  await (await oldResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(
    page.getByRole('heading', { name: 'Der Termin wurde abgesagt', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/#token=storniert$/);
  await expectNoHorizontalOverflow(page);
});

test('an old action conflict cannot appear after switching the management link during refresh', async ({
  page,
}) => {
  let delayRefresh = false;
  let requested: () => void = () => undefined;
  let release: () => void = () => undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/nikolaus/manage/lookup', async (route) => {
    const body = route.request().postDataJSON() as { token?: string };
    if (!delayRefresh || body.token !== 'mock') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    requested();
    await delay;
    await route.fulfill({ response });
  });
  await page.route('**/api/nikolaus/manage/update', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ALREADY_CHANGED', message: 'Previous booking conflict' }),
    })
  );
  await page.goto('/nikolaus/termin#token=mock');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  delayRefresh = true;
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await refreshStarted;
  await page.evaluate(() => {
    location.hash = 'token=storniert';
  });
  await expect(
    page.getByRole('heading', { name: 'Der Termin wurde abgesagt', exact: true })
  ).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/nikolaus/manage/lookup') &&
      (response.request().postDataJSON() as { token?: string }).token === 'mock'
  );
  release();
  await (await oldResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(page.getByText('Previous booking conflict', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Der Termin wurde abgesagt', exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a stale Nikolaus update reports a real conflict and preserves the newer booking', async ({
  page,
  request,
}, testInfo) => {
  await page.goto('/nikolaus/termin#token=mock');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const stalePhone = testInfo.project.name === 'mobile' ? '+49 170 1234511' : '+49 170 1234512';
  const newerPhone = testInfo.project.name === 'mobile' ? '+49 170 1234521' : '+49 170 1234522';
  await page.getByLabel('Telefon (möglichst Handynummer)').fill(stalePhone);
  const lookup = await request.post('/api/nikolaus/manage/lookup', { data: { token: 'mock' } });
  expect(lookup.headers()['x-mock-api']).toBe('1');
  const current = (await lookup.json()) as NikolausBookingInfo;
  const secondActor = await request.post('/api/nikolaus/manage/update', {
    data: {
      ...current,
      token: 'mock',
      phone: newerPhone,
    },
  });
  expect(secondActor.status()).toBe(200);
  const saveResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/nikolaus/manage/update')
  );
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  expect((await saveResponse).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText(
    'Ihr Termin wurde inzwischen geändert. Bitte laden Sie die Buchung neu.'
  );
  await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Telefon (möglichst Handynummer)')).toHaveValue(newerPhone);
  await page.reload();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Telefon (möglichst Handynummer)')).toHaveValue(newerPhone);
  await expectNoHorizontalOverflow(page);
});

test('saving staff tags adopts the complete contact version after a concurrent family update', async ({
  page,
  request,
}, testInfo) => {
  const phone = testInfo.project.name === 'mobile' ? '+49 170 1234591' : '+49 170 1234592';
  await page.route('**/api/intern/pflege/nikolaus-bookings/*/tags', async (route) => {
    const savedTags = await route.fetch();
    expect(savedTags.status()).toBe(200);
    const loaded = await request.post('/api/nikolaus/manage/lookup', {
      data: { token: 'mock' },
    });
    const current = (await loaded.json()) as NikolausBookingInfo;
    const changed = await request.post('/api/nikolaus/manage/update', {
      data: { ...current, token: 'mock', phone },
    });
    expect(changed.status()).toBe(200);
    const overview = (await (
      await request.get('/api/intern/nikolaus/bookings')
    ).json()) as StaffNikolausOverview;
    const booking = overview.bookings.find((entry) => entry.familyName === current.familyName);
    expect(booking?.phone).toBe(phone);
    // Models the server's fresh read after its tags PATCH, including concurrent contact changes.
    await route.fulfill({ response: savedTags, json: { booking } });
  });
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Interne Tags', exact: true })
    .fill(`contact-version-${testInfo.project.name}`);
  await dialog.getByRole('combobox', { name: 'Interne Tags', exact: true }).press('Enter');
  await dialog.getByRole('button', { name: 'Tags speichern', exact: true }).click();
  await expect(dialog.getByText('Tags gespeichert.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: phone, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Details schließen', exact: true }).click();
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  await expect(dialog.getByRole('link', { name: phone, exact: true })).toBeVisible();
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
  // Rejecting needs a reason, which is mailed to the uploader
  await page.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(page.getByText('Bitte begründen, warum der Beleg abgelehnt wird.')).toBeVisible();
  await page.getByLabel('Bemerkung der Kasse').fill('Bitte die Rückseite mit dem Betrag ergänzen.');
  await page.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(
    page.getByText(/abgelehnt\. leitung@example\.test hat die Begründung/)
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: /^Abgelehnt/ }).click();
  await card.click();
  await page.getByRole('button', { name: 'Erneut einreichen', exact: true }).click();
  await expect(page.getByText(`Beleg von ${shop} erneut eingereicht.`)).toBeVisible();
  await page.getByRole('button', { name: /^Offen/ }).click();
  await card.click();
  await page.getByRole('button', { name: 'Annehmen', exact: true }).click();
  await expect(page.getByText(new RegExp(`Beleg von ${shop} angenommen`))).toBeVisible();
  await page.getByRole('button', { name: /^Angenommen/ }).click();
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
