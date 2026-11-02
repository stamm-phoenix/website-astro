import { test, expect } from './fixtures';

test('a pending reload locks its dialog until the original notice has been loaded', async ({
  page,
}) => {
  let delay = false;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = (): void => {};
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/intern/pflege/gruppenstunden', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items.find((item: { stufe: string }) => item.stufe === 'Wölflinge').exception = {
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      message: 'Aktuelle Fassung',
      location: '',
      time: '',
    };
    if (delay) {
      started();
      await gate;
    }
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/intern/pflege/gruppenstunden/*/hinweis', (route) =>
    route.fulfill({ status: 409, json: { code: 'CONFLICT', message: 'Inzwischen geändert.' } })
  );
  await page.goto('/leitendenbereich/gruppenstunden-hinweise');
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Wölflinge', exact: true }) })
    .getByRole('button', { name: 'Hinweis bearbeiten', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Hinweis für Wölflinge bearbeiten',
    exact: true,
  });
  await dialog.getByLabel('Hinweis', { exact: true }).fill('Entwurf');
  await dialog.getByRole('button', { name: 'Hinweis veröffentlichen', exact: true }).click();
  delay = true;
  await dialog.getByRole('button', { name: 'Aktuelle Fassung laden', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Aktuelle Fassung laden?', exact: true })
    .getByRole('button', { name: 'Neu laden', exact: true })
    .click();
  await requestStarted;
  try {
    await expect(dialog.locator('#gs-exception-message')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally {
    release();
  }
  await expect(dialog.locator('#gs-exception-message')).toBeEnabled();
  await expect(dialog.getByLabel('Hinweis', { exact: true })).toHaveValue('Aktuelle Fassung');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toBeHidden();
});
