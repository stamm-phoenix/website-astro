import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type {
  StaffNikolausOverview,
  StaffNikolausHelfendeData,
  StaffNikolausSteuerung,
} from '../src/lib/types';

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' });
});

test('family characteristics survive a conflict and only reload after explicit discard', async ({
  page,
}) => {
  const overview = (await (
    await page.request.get('/api/intern/nikolaus/bookings')
  ).json()) as StaffNikolausOverview;
  const original = overview.bookings.find((b) => b.familyName === 'Huber')!;
  let conflict = false;
  let saves = 0;
  await page.route('**/api/intern/nikolaus/bookings', async (route) => {
    const data = structuredClone(overview);
    if (conflict)
      Object.assign(
        data.bookings.find((b) => b.id === original.id)!,
        { etag: 'fresh-booking', internalTags: ['Servermerkmal'] }
      );
    await route.fulfill({ json: data });
  });
  await page.route('**/api/intern/pflege/nikolaus-bookings/*/tags', async (route) => {
    saves++;
    if (saves === 1) {
      conflict = true;
      return route.fulfill({
        status: 409,
        json: { message: 'Die Anmeldung wurde inzwischen geändert.' },
      });
    }
    expect(route.request().postDataJSON().etag).toBe('fresh-booking');
    await route.fulfill({
      json: {
        booking: {
          ...original,
          etag: 'saved-booking',
          internalTags: route.request().postDataJSON().tags,
        },
      },
    });
  });
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  const editor = page.getByRole('dialog', { name: 'Familie Huber', exact: true });
  await editor.locator('#booking-tags-input').fill('Mein Merkmal');
  await editor.locator('#booking-tags-input').press('Enter');
  await editor.getByRole('button', { name: 'Merkmale speichern', exact: true }).click();
  await expect(
    editor.getByRole('button', { name: 'Mein Merkmal entfernen', exact: true })
  ).toBeVisible();
  const reload = editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true });
  await reload.click();
  const confirm = page.getByRole('dialog', { name: /Aktuelle Merkmale.*laden/ });
  await confirm.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(
    editor.getByRole('button', { name: 'Mein Merkmal entfernen', exact: true })
  ).toBeVisible();
  await reload.click();
  await confirm.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await expect(
    editor.getByRole('button', { name: 'Servermerkmal entfernen', exact: true })
  ).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Mein Merkmal entfernen', exact: true })
  ).toHaveCount(0);
  await editor.locator('#booking-tags-input').fill('Neu');
  await editor.locator('#booking-tags-input').press('Enter');
  await editor.getByRole('button', { name: 'Merkmale speichern', exact: true }).click();
  await expect(editor).toContainText('Merkmale gespeichert.');
  await expectNoHorizontalOverflow(page);
});

test('a helper conflict can load the current version and save with its new etag', async ({
  page,
}) => {
  const data = (await (
    await page.request.get('/api/intern/nikolaus/helfende')
  ).json()) as StaffNikolausHelfendeData;
  const original = data.persons.find((p) => p.name === 'Katharina Huber')!;
  let conflict = false;
  let saves = 0;
  await page.route('**/api/intern/nikolaus/helfende', async (route) => {
    const current = structuredClone(data);
    if (conflict)
      Object.assign(
        current.persons.find((p) => p.id === original.id)!,
        { etag: 'fresh-helper', name: 'Katharina Neu' }
      );
    await route.fulfill({ json: current });
  });
  await page.route('**/api/intern/pflege/nikolaus-helfende/*', async (route) => {
    saves++;
    if (saves === 1) {
      conflict = true;
      return route.fulfill({
        status: 409,
        json: { message: 'Die Person wurde inzwischen geändert.' },
      });
    }
    expect(route.request().postDataJSON().etag).toBe('fresh-helper');
    await route.fulfill({ json: {} });
  });
  await page.goto('/leitendenbereich/nikolaus-helfende');
  await page.getByRole('button', { name: /^Bearbeiten.*Katharina Huber/ }).click();
  const editor = page.getByRole('dialog', { name: 'Person bearbeiten', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill('Mein Entwurf');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Mein Entwurf');
  await editor.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Aktuelle Fassung laden?', exact: true });
  await confirm.getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Katharina Neu');
  await editor.getByLabel('Name', { exact: true }).fill('Katharina Geprüft');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(editor).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('settings conflict retains the draft, offers reload, then saves the new version', async ({
  page,
}) => {
  const current = (await (
    await page.request.get('/api/intern/nikolaus/steuerung')
  ).json()) as StaffNikolausSteuerung;
  let saves = 0;
  await page.route('**/api/intern/nikolaus/steuerung', (route) =>
    route.fulfill({ json: { ...current, etag: saves ? 'fresh-settings' : current.etag } })
  );
  await page.route('**/api/intern/pflege/nikolaus-steuerung', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { ...current, etag: saves ? 'fresh-settings' : current.etag } });
    saves++;
    if (saves === 1)
      return route.fulfill({
        status: 409,
        json: { message: 'Die Einstellungen wurden inzwischen geändert.' },
      });
    expect(route.request().postDataJSON().etag).toBe('fresh-settings');
    await route.fulfill({
      json: {
        ...current,
        etag: 'saved-settings',
        settings: route.request().postDataJSON().settings,
      },
    });
  });
  await page.goto('/leitendenbereich/nikolaus-steuerung');
  const hold = page.getByLabel('Reservierungsdauer (Minuten)');
  await hold.fill('90');
  await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
  await expect(hold).toHaveValue('90');
  await page.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Aktuelle Einstellungen laden?', exact: true });
  await confirm.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(hold).toHaveValue('90');
  await page.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await confirm.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await expect(hold).toHaveValue(String(current.settings.pendingHoldMinutes));
  await hold.fill('100');
  await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
  await expect(page.getByText(/^Gespeichert\./).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
