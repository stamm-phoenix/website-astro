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
