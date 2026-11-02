import { test, expect } from './fixtures';

test('temporary notice can be saved, displayed publicly and removed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/gruppenstunden');
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gruppenstunde Wölflinge bearbeiten' });
  await dialog.getByLabel('Abweichung anzeigen', { exact: true }).check();
  await dialog.getByLabel('Von', { exact: true }).fill('2020-01-01');
  await dialog.getByLabel('Bis', { exact: true }).fill('2099-12-31');
  await dialog.getByLabel('Hinweis', { exact: true }).fill('Diese Woche am Spielplatz');
  await dialog.getByLabel(/Abweichender Ort/).fill('Spielplatz');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/gruppenstunden');
  await expect(page.getByText('Diese Woche am Spielplatz', { exact: true })).toBeVisible();
  await page.goto('/leitendenbereich/gruppenstunden');
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)', exact: true }).click();
  await expect(dialog.getByLabel('Hinweis', { exact: true })).toHaveValue(
    'Diese Woche am Spielplatz'
  );
  await dialog.getByLabel('Hinweis', { exact: true }).fill('Neuer Hinweis per Enter');
  const enterSave = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/pflege/gruppenstunden/')
  );
  await dialog.getByLabel('Hinweis', { exact: true }).press('Enter');
  expect((await enterSave).postDataJSON().exception.message).toBe('Neuer Hinweis per Enter');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)', exact: true }).click();
  const rescued = {
    startDate: '2020-02-02',
    endDate: '2099-11-30',
    message: 'Geretteter Hinweis',
    location: 'Wiese',
    time: '18 Uhr',
  };
  for (const [id, value] of Object.entries({
    'gs-exception-start': rescued.startDate,
    'gs-exception-end': rescued.endDate,
    'gs-exception-message': rescued.message,
    'gs-exception-location': rescued.location,
    'gs-exception-time': rescued.time,
  })) {
    await dialog.locator('#' + id).evaluate((element, text) => {
      (element as HTMLInputElement).value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  const rescuedSave = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().includes('/pflege/gruppenstunden/')
  );
  await dialog.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
  expect((await rescuedSave).postDataJSON().exception).toEqual(rescued);
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)', exact: true }).click();
  await dialog.getByLabel('Abweichung anzeigen', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/gruppenstunden');
  await expect(page.getByText('Diese Woche am Spielplatz', { exact: true })).toHaveCount(0);
});

test('a notice expires on the Berlin date boundary while the page stays open', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T21:59:30Z') });
  await page.route('**/api/gruppenstunden', async (route) => {
    const response = await route.fetch();
    const groups = await response.json();
    groups[0].exception = {
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      message: 'Nur heute',
      location: '',
      time: '',
    };
    await route.fulfill({ response, json: groups });
  });
  await page.goto('/gruppenstunden');
  await expect(page.getByText('Nur heute', { exact: true })).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(page.getByText('Nur heute', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Gruppenstunde', { exact: true }).first()).toBeVisible();
});
