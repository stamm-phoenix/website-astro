import { test, expect } from './fixtures';

test('a dedicated module publishes, edits and removes notices without regular meeting fields', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/gruppenstunden');
  await page.getByRole('button', { name: 'Bearbeiten (Wölflinge)', exact: true }).click();
  const regular = page.getByRole('dialog', { name: 'Gruppenstunde Wölflinge bearbeiten' });
  await expect(regular.getByLabel('Hinweis', { exact: true })).toHaveCount(0);
  await regular.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('link', { name: 'Hinweise verwalten', exact: true }).click();
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Wölflinge', exact: true }) });
  await card.getByRole('button', { name: 'Hinweis veröffentlichen', exact: true }).click();
  let dialog = page.getByRole('dialog', {
    name: 'Hinweis für Wölflinge veröffentlichen',
    exact: true,
  });
  await expect(dialog.getByLabel('Wochentag')).toHaveCount(0);
  await dialog.getByLabel('Von', { exact: true }).fill('2020-01-01');
  await dialog.getByLabel('Bis', { exact: true }).fill('2099-12-31');
  await dialog.getByLabel('Hinweis', { exact: true }).fill('Diese Woche am Spielplatz');
  await dialog.getByLabel(/Abweichender Ort/).fill('Spielplatz');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('hinweis-dialog.png') });
  await page.route('**/api/intern/pflege/gruppenstunden/*/hinweis', (route) =>
    route.fulfill({
      status: 400,
      json: {
        code: 'VALIDATION_ERROR',
        message: 'Bitte prüfe deine Eingaben.',
        fields: { exceptionStartDate: 'Bitte ein gültiges Datum angeben.' },
      },
    })
  );
  await dialog.getByRole('button', { name: 'Hinweis veröffentlichen', exact: true }).click();
  await expect(dialog.getByLabel('Von', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByLabel('Von', { exact: true })).toHaveAttribute(
    'aria-describedby',
    /error/
  );
  await expect(dialog.getByLabel('Hinweis', { exact: true })).toHaveValue(
    'Diese Woche am Spielplatz'
  );
  await page.unroute('**/api/intern/pflege/gruppenstunden/*/hinweis');
  const save = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/hinweis'));
  await dialog.getByRole('button', { name: 'Hinweis veröffentlichen', exact: true }).click();
  expect(Object.keys((await save).postDataJSON()).sort()).toEqual(['etag', 'exception']);
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Diese Woche am Spielplatz', { exact: true })).toBeVisible();
  await page.goto('/gruppenstunden');
  await expect(page.getByText('Diese Woche am Spielplatz', { exact: true })).toBeVisible();
  await page.goto('/leitendenbereich/gruppenstunden-hinweise');
  await card.getByRole('button', { name: 'Hinweis bearbeiten', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Hinweis für Wölflinge bearbeiten', exact: true });
  await dialog.getByLabel('Hinweis', { exact: true }).fill('Geändert mit Enter');
  const editSave = page.waitForRequest(
    (r) => r.method() === 'PATCH' && r.url().endsWith('/hinweis')
  );
  await dialog.getByLabel('Hinweis', { exact: true }).press('Enter');
  expect((await editSave).postDataJSON().exception.message).toBe('Geändert mit Enter');
  await expect(card.getByText('Geändert mit Enter', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Hinweis bearbeiten', exact: true }).click();
  await dialog.locator('summary', { hasText: 'Weitere Aktionen' }).click();
  await dialog.getByRole('button', { name: 'Hinweis entfernen', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Hinweis für Wölflinge entfernen?', exact: true })
    .getByRole('button', { name: 'Hinweis entfernen', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Kein Hinweis', { exact: true })).toBeVisible();
  await page.goto('/gruppenstunden');
  await expect(page.getByText('Geändert mit Enter', { exact: true })).toHaveCount(0);
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
