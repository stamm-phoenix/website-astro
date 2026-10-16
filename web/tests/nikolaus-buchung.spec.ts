import { test, expect, expectNoHorizontalOverflow, expectWithinWindowWidth } from './fixtures';
import type { NikolausBookingInfo, StaffNikolausOverview } from '../src/lib/types';

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
    .getByRole('combobox', { name: 'Merkmale für die Einteilung', exact: true })
    .fill(`contact-version-${testInfo.project.name}`);
  await dialog
    .getByRole('combobox', { name: 'Merkmale für die Einteilung', exact: true })
    .press('Enter');
  await dialog.getByRole('button', { name: 'Merkmale speichern', exact: true }).click();
  await expect(dialog.getByText('Merkmale gespeichert.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: phone, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Details schließen', exact: true }).click();
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  await expect(dialog.getByRole('link', { name: phone, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('an expired login while saving staff tags offers the new login', async ({ page }) => {
  await page.route('**/api/intern/pflege/nikolaus-bookings/*/tags', (route) =>
    route.fulfill({ status: 401, body: '' })
  );
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  const dialog = page.getByRole('dialog');
  const tags = dialog.getByRole('combobox', { name: 'Merkmale für die Einteilung', exact: true });
  await tags.fill('abgelaufen');
  await tags.press('Enter');
  await dialog.getByRole('button', { name: 'Merkmale speichern', exact: true }).click();
  await expect(dialog).toContainText('Deine Anmeldung ist abgelaufen.');
  await expect(dialog.getByRole('link', { name: 'Neu anmelden (öffnet neuen Tab)' })).toBeVisible();
});

test('on a phone all five values of a Nikolaus day are visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Narrow screens only');
  await page.goto('/leitendenbereich/nikolaus');
  await page.getByRole('heading', { name: 'Überblick über die Tage', exact: true }).click();
  const section = page.getByRole('region', { name: 'Überblick über die Tage', exact: true });
  const day = section.getByRole('row').nth(1);
  await expectWithinWindowWidth(page, day.getByRole('rowheader'));
  const cells = day.getByRole('cell');
  await expect(cells).toHaveCount(4);
  for (const cell of await cells.all()) await expectWithinWindowWidth(page, cell);
  // Without column headers on screen, each value carries its own label
  for (const [index, label] of ['Bestätigt', 'Ausstehend', 'Frei', 'Kinder'].entries()) {
    await expect(cells.nth(index)).toHaveText(new RegExp(`^${label}\\s*\\d+`));
  }
  await expectNoHorizontalOverflow(page);
});
