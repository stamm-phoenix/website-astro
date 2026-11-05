import { test, expect } from './fixtures';

test('Treffpunkt, Unterlagen und Packliste am öffentlichen Termin', async ({ page }) => {
  await page.route('**/api/aktionen', (route) =>
    route.fulfill({
      json: [
        {
          id: 'unterlagen-test',
          title: 'Sommerlager mit Unterlagen',
          stufen: ['Wölflinge'],
          start: '2027-08-01',
          end: '2027-08-08',
          meetingPoint: 'Pfarrheim',
          packingList: ['Schlafsack', 'Isomatte', 'Trinkflasche'],
          downloads: [
            { id: 'testdatei', fileName: 'Anmeldung.pdf', size: 123, mimeType: 'application/pdf' },
          ],
        },
      ],
    })
  );
  await page.goto('/aktionen');
  await page.getByRole('button', { name: /Sommerlager mit Unterlagen/ }).click();
  await expect(page.getByText('Pfarrheim', { exact: true })).toBeVisible();
  await expect(page.getByText('Schlafsack', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Anmeldung.pdf' })).toHaveAttribute(
    'href',
    '/api/downloads/testdatei/file'
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Packliste als PDF' }).click();
  expect((await download).suggestedFilename()).toBe('Packliste Sommerlager mit Unterlagen.pdf');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Leitende ergänzen Unterlagen ohne Eingaben bei einem Fehler zu verlieren', async ({
  page,
}) => {
  await page.route('**/api/downloads', (route) =>
    route.fulfill({ json: [{ id: 'anmeldung', fileName: 'Anmeldung.pdf' }] })
  );
  await page.goto('/leitendenbereich/aktionen');
  await page.getByRole('button', { name: 'Aktion anlegen', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Unterlagen-Test');
  await page.getByLabel('Beginn', { exact: true }).fill('2027-08-01');
  await page.getByLabel('Wölflinge', { exact: true }).check();
  await page.getByLabel('Treffpunkt', { exact: false }).fill('Pfarrheim');
  await page
    .getByLabel('Packliste – ein Gegenstand pro Zeile', { exact: false })
    .fill('Schlafsack\nIsomatte');
  await page.getByLabel('Anmeldung.pdf', { exact: true }).check();
  let received: Record<string, unknown> = {};
  await page.route('**/api/intern/pflege/aktionen', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    received = route.request().postDataJSON();
    await route.fulfill({
      status: 500,
      json: { error: { code: 'INTERNAL', message: 'Speichern fehlgeschlagen.' } },
    });
  });
  await page.getByRole('button', { name: 'Aktion anlegen', exact: true }).last().click();
  await expect(page.getByLabel('Treffpunkt', { exact: false })).toHaveValue('Pfarrheim');
  expect(received.downloadIds).toEqual(['anmeldung']);
  expect(received.meetingPoint).toBe('Pfarrheim');
  expect(received.packingList).toEqual(['Schlafsack', 'Isomatte']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Demo speichert Aktionsunterlagen beim Wiederöffnen und öffentlichen Termin', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aktionen');
  await page.getByRole('button', { name: 'Aktion anlegen', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Demo-Unterlagen');
  await page.getByLabel('Beginn', { exact: true }).fill('2026-12-01');
  await page.getByLabel('Wölflinge', { exact: true }).check();
  await page.getByLabel('Treffpunkt', { exact: false }).fill('Pfarrheim');
  await page
    .getByLabel('Packliste – ein Gegenstand pro Zeile', { exact: false })
    .fill('Schlafsack\nIsomatte');
  const firstFile = page
    .getByRole('group', { name: 'Unterlagen', exact: true })
    .getByRole('checkbox')
    .first();
  await firstFile.check();
  const fileId = await firstFile.inputValue();
  await page.getByRole('button', { name: 'Aktion anlegen', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('button', { name: 'Kalendereintrag bearbeiten: Demo-Unterlagen', exact: true })
    .click();
  await expect(page.getByLabel('Treffpunkt', { exact: false })).toHaveValue('Pfarrheim');
  await expect(
    page.getByLabel('Packliste – ein Gegenstand pro Zeile', { exact: false })
  ).toHaveValue('Schlafsack\nIsomatte');
  await expect(page.locator(`input[type="checkbox"][value="${fileId}"]`)).toBeChecked();
  await page.goto('/aktionen');
  await page.getByRole('button', { name: /Demo-Unterlagen/ }).click();
  await expect(page.getByText('Pfarrheim', { exact: true })).toBeVisible();
  await expect(page.getByText('Schlafsack', { exact: true })).toBeVisible();
  await expect(page.locator(`a[href="/api/downloads/${fileId}/file"]`)).toBeVisible();
});

test('Fehler der Dateiauswahl führt den Fokus zur Korrektur', async ({ page }) => {
  await page.route('**/api/downloads', (route) =>
    route.fulfill({ json: [{ id: 'anmeldung', fileName: 'Anmeldung.pdf' }] })
  );
  await page.goto('/leitendenbereich/aktionen');
  await page.getByRole('button', { name: 'Aktion anlegen', exact: true }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Unterlagenfehler');
  await page.getByLabel('Beginn', { exact: true }).fill('2026-12-01');
  await page.getByLabel('Wölflinge', { exact: true }).check();
  await page.route('**/api/intern/pflege/aktionen', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 400,
          json: {
            code: 'INVALID',
            message: 'Bitte korrigieren.',
            fields: { downloadIds: 'Es dürfen höchstens 100 Unterlagen verknüpft werden.' },
          },
        })
      : route.continue()
  );
  await page.getByRole('button', { name: 'Aktion anlegen', exact: true }).last().click();
  const checkbox = page.getByLabel('Anmeldung.pdf', { exact: true });
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toHaveAttribute('aria-invalid', 'true');
  await expect(checkbox).toHaveAccessibleDescription(
    'Es dürfen höchstens 100 Unterlagen verknüpft werden.'
  );
});
