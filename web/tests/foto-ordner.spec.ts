import { test, expect } from './fixtures';

test('leere Schuljahres- und Gruppenordner ohne Dateien erstellen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/fotos#ansicht=hochladen&ziel=Gruppenstunden');
  const name = page.getByLabel('Neuer Ordner darin');
  await name.fill('Schuljahr 2027-28');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toContainText(
    'Schuljahr 2027-28'
  );
  await expect(name).toHaveValue('');
  await name.fill('Wölflinge');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toContainText(
    'Wölflinge'
  );
  const response = await page.request.get(
    '/api/intern/fotos/ordner?pfad=Gruppenstunden/Schuljahr%202027-28'
  );
  expect((await response.json()).folders).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Wölflinge' })])
  );
  await page.screenshot({ path: 'test-results/foto-ordner-nachher.png', fullPage: true });
});

test('Fehler erhält den Ordnernamen für einen neuen Versuch', async ({ page }) => {
  await page.goto('/leitendenbereich/fotos#ansicht=hochladen&ziel=Gruppenstunden');
  await page.route('**/api/intern/fotos/ziel', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue()
  );
  await page.getByLabel('Neuer Ordner darin').fill('Neuer Ordner');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('alert').last()).toBeVisible();
  await expect(page.getByLabel('Neuer Ordner darin')).toHaveValue('Neuer Ordner');
  await page.unroute('**/api/intern/fotos/ziel');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toBeVisible();
});

test('Upload zeigt fehlendes Ziel und unbrauchbaren Ordnernamen', async ({ page }) => {
  await page.goto('/leitendenbereich/fotos#ansicht=hochladen&ziel=');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('photo') });
  await page.getByRole('button', { name: '1 Datei hochladen', exact: true }).click();
  await expect(
    page.getByText('Wähle einen Ordner aus oder gib einen neuen Ordnernamen ein.', { exact: false })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Gruppenstunden', exact: true }).click();
  await page.getByLabel('Neuer Ordner darin').fill('???');
  await page.getByRole('button', { name: '1 Datei hochladen', exact: true }).click();
  await expect(
    page.getByText('Der neue Ordnername enthält nur Zeichen, die SharePoint nicht erlaubt.')
  ).toBeVisible();
  await expect(page.getByLabel('Neuer Ordner darin')).toHaveAttribute('aria-invalid', 'true');
});

test('verspätete Ordnerantwort erhält den neueren Uploadentwurf', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route('**/api/intern/fotos/ziel', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    received();
    await gate;
    await route.fulfill({ json: { path: 'Gruppenstunden/Alter Ordner' } });
  });
  await page.goto('/leitendenbereich/fotos#pfad=Aktionen&ansicht=hochladen&ziel=Gruppenstunden');
  await page.getByLabel('Neuer Ordner darin').fill('Alter Ordner');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Fotos ansehen', exact: true }).click();
  await page.getByRole('button', { name: 'Hierher hochladen', exact: true }).click();
  await page.getByLabel('Neuer Ordner darin').fill('Neuer Entwurf');
  const refreshed = page.waitForResponse((response) =>
    response.url().includes('/fotos/ordner?pfad=Gruppenstunden')
  );
  release();
  await refreshed;
  await expect(page.getByLabel('Neuer Ordner darin')).toHaveValue('Neuer Entwurf');
});

test('Ordnererstellung erneuert eine noch laufende alte Elternabfrage', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  let first = true;
  await page.route('**/api/intern/fotos/ordner?pfad=Gruppenstunden', async (route) => {
    if (!first) return route.continue();
    first = false;
    const old = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response: old });
  });
  await page.goto('/leitendenbereich/fotos#ansicht=hochladen&ziel=Gruppenstunden');
  await started;
  await page.getByLabel('Neuer Ordner darin').fill('Schuljahr Cachetest');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toBeVisible();
  release();
  await page.getByRole('button', { name: 'Gruppenstunden', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Schuljahr Cachetest', exact: true })
  ).toBeVisible();
});

test('Ordnererstellung beseitigt den überholten Uploadzielfehler', async ({ page }) => {
  await page.goto('/leitendenbereich/fotos#ansicht=hochladen&ziel=');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('photo') });
  await page.getByRole('button', { name: '1 Datei hochladen', exact: true }).click();
  await expect(
    page.getByText('Wähle einen Ordner aus oder gib einen neuen Ordnernamen ein.', { exact: false })
  ).toBeVisible();
  await expect(page.getByLabel('Neuer Ordner darin')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Neuer Ordner darin').fill('Schuljahr Fehlerkorrektur');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toBeVisible();
  await expect(
    page.getByText('Wähle einen Ordner aus oder gib einen neuen Ordnernamen ein.', { exact: false })
  ).toHaveCount(0);
  await expect(page.getByLabel('Neuer Ordner darin')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: '1 Datei hochladen', exact: true })).toBeVisible();
});
