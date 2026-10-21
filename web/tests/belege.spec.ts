import { test, expect } from './fixtures';

test('closing the Beleg dialog asks before a chosen photo is discarded', async ({ page }) => {
  await page.goto('/leitendenbereich/belege/');
  await page.getByRole('button', { name: 'Beleg einreichen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  await expect(dialog).toBeVisible();

  // A light receipt on a dark background, so the scan finds its edges.
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 800, 1200);
    context.fillStyle = '#fff';
    context.fillRect(120, 120, 560, 960);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'beleg.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo),
  });
  await expect(dialog.getByText('Anderes Foto wählen')).toBeVisible();

  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toBeVisible();
});

test('the Kasse transfers an accepted receipt to CampFlow with the chosen Kategorie', async ({
  page,
}) => {
  // Answered here, so the shared demo keeps its receipt for the other tests
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/intern/pflege/belege/*/campflow', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      json: {
        campflow: { state: 'Hochgeladen', number: '2026-112' },
        created: true,
        deleted: true,
      },
    });
  });
  await page.goto('/leitendenbereich/belege/');
  const accepted = page.getByRole('button', { name: /^Angenommen/ });
  // The counts appear once the list is loaded and the filter works
  await expect(accepted).toHaveText(/\(\d+\)/);
  await accepted.click();
  await page.getByRole('button', { name: /Deutsche Bahn/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von Deutsche Bahn' });

  // The Kostenstelle named like the Aktion is preselected; the Kategorie is the Kasse's choice
  const transfer = dialog.getByRole('button', { name: 'Nach CampFlow übertragen' });
  await expect(dialog.getByLabel('Kostenstelle')).toHaveValue('cun_Sola26');
  await expect(transfer).toBeDisabled();
  await dialog.getByLabel('Kategorie').selectOption({ label: 'Fahrtkosten' });
  await transfer.click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(
      'Beleg von Deutsche Bahn ist in CampFlow als 2026-112 gebucht und wurde hier gelöscht.'
    )
  ).toBeVisible();
  expect(sent).toMatchObject({ costUnitId: 'cun_Sola26', categoryId: 'cat_Sola262' });
  expect(sent?.etag).toBeTruthy();
});

test('all receipts from CampFlow can be filtered and opened with their image', async ({ page }) => {
  await page.goto('/leitendenbereich/belege/');
  const inCampflow = page.getByRole('button', { name: /^In CampFlow/ });
  await expect(inCampflow).toHaveText(/\(5\)/);
  await inCampflow.click();
  await expect(page.getByTestId('campflow-belege-stand')).toBeVisible();
  const list = page.getByRole('list', { name: 'Belege in CampFlow' });
  await expect(list.getByRole('listitem')).toHaveCount(5);

  // Kostenstelle and Kategorie narrow the list, the status tabs too
  await page.getByLabel('Kostenstelle').selectOption({ label: 'Sommerlager 2026 Oberjoch' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.getByLabel('Kategorie').selectOption({ label: 'Fahrtkosten' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('Erstattet')).toBeVisible();
  await page.getByLabel('Kostenstelle').selectOption({ label: 'Alle Kostenstellen' });
  await page.getByRole('button', { name: /^Zahlung offen/ }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: /^Alle/ }).last().click();

  // Own receipts: paid out of pocket by the demo user, matched by name
  await page.getByLabel('Nur meine Belege').check();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByText('Sam Beispiel')).toHaveCount(0);

  await list.getByRole('button', { name: /Edeka – Grillabend/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edeka – Grillabend' });
  await expect(dialog.getByText('2026-104')).toBeVisible();
  await expect(dialog.getByText('Gebucht, Erstattung offen')).toBeVisible();
  await expect(dialog.getByText('von dir über die Website')).toBeVisible();
  await expect(dialog.getByRole('img', { name: /Beleg 2026-104/ }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();
});

test('the start page lists my receipts with their state', async ({ page }) => {
  await page.goto('/leitendenbereich/');
  const box = page.getByRole('region', { name: 'Meine Belege' });
  await expect(box).toBeVisible();
  const items = box.getByTestId('meine-belege').getByRole('listitem');
  await expect(items.first()).toBeVisible();
  // Submitted here and booked in CampFlow, newest first
  await expect(box.getByText('Edeka – Grillabend')).toBeVisible();
  await expect(box.getByText('Gebucht, Erstattung offen')).toBeVisible();
  await expect(box.getByRole('link', { name: 'Zu den Belegen' })).toHaveAttribute(
    'href',
    '/leitendenbereich/belege'
  );
});

test('my receipts from CampFlow show even if the submitted ones fail to load', async ({ page }) => {
  await page.route('**/api/intern/pflege/belege', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: { code: 'X', message: 'kaputt' } } })
      : route.fallback()
  );
  await page.goto('/leitendenbereich/');
  const box = page.getByRole('region', { name: 'Meine Belege' });
  // The load error says what to do and whom to ask
  await expect(box.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toBeVisible();
  await expect(box.getByText('Edeka – Grillabend')).toBeVisible();
  await expect(box.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
});
