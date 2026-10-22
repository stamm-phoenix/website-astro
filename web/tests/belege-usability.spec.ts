import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { BelegCheck, StaffBeleg } from '../src/lib/types';

const knownCheck: BelegCheck = {
  ok: true,
  isReceipt: true,
  complete: true,
  readable: true,
  issues: [],
  restrictedItems: [],
  shop: 'Testmarkt',
  date: '2026-09-30',
  amountCent: 999,
  checkedAt: '2026-10-01T12:00:00Z',
};

test('a new receipt asks how it was paid without preselecting a payout', async ({ page }) => {
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const ownMoney = dialog.getByRole('radio', {
    name: 'Mit meinem Geld – bitte an mich auszahlen',
    exact: true,
  });
  const clubMoney = dialog.getByRole('radio', {
    name: 'Mit Stammeskarte / aus der Kasse',
    exact: true,
  });
  await expect(ownMoney).not.toBeChecked();
  await expect(clubMoney).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Einreichen', exact: true }).click();
  await expect(
    dialog.getByText('Bitte auswählen, wie bezahlt wurde.', { exact: true })
  ).toBeVisible();
  await clubMoney.check();
  await expect(clubMoney).toBeChecked();
  await expect(ownMoney).not.toBeChecked();
  await expectNoHorizontalOverflow(page);
});

test('the check of a new photo shows its progress until the answer arrives', async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/pflege/belege/pruefung', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3a3027';
    context.fillRect(0, 0, 1200, 1600);
    context.fillStyle = '#f4f1ea';
    context.fillRect(250, 200, 700, 1200);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'beleg.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) });
  const progress = dialog.getByTestId('beleg-pruefung');
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('Beleg wird geprüft …');
  await progress.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pruefung.png') });
  release();
  await expect(progress).toBeHidden();
  await expect(dialog.getByLabel('Geschäft')).toHaveValue('Demo-Markt');
});

test('my own Auslage takes the name of the linked CampFlow person without a name claim', async ({
  page,
}) => {
  // A login without its name, and the linked CampFlow person known only a moment later
  const principal = await (await page.request.get('/.auth/me')).json();
  principal.clientPrincipal.claims = [];
  await page.route('**/.auth/me', (route) => route.fulfill({ json: principal }));
  let releaseIch!: () => void;
  const ichHeld = new Promise<void>((resolve) => (releaseIch = resolve));
  await page.route('**/api/intern/ich', async (route) => {
    await ichHeld;
    await route.fulfill({
      json: {
        login: principal.clientPrincipal.userDetails,
        campflow: { id: 'per_kim', firstName: 'Kim', lastName: 'Verknüpft' },
      },
    });
  });
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/api/intern/pflege/belege/41', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { mailed: false, etag: 'gespeichert' } });
  });
  await page.goto('/leitendenbereich/belege/');
  await page.getByRole('button', { name: /REWE/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg von REWE' });
  await dialog
    .getByRole('radio', { name: 'Mit meinem Geld – bitte an mich auszahlen', exact: true })
    .check();
  releaseIch();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sent.at(-1)).toMatchObject({ payout: true, paidBy: 'Kim Verknüpft' });
});

test('an Auslage of someone else names that person, the savings book names itself', async ({
  page,
}) => {
  // Answered here, so the shared demo keeps its receipts for the other tests
  const sent: Array<Record<string, unknown>> = [];
  await page.route('**/api/intern/pflege/belege/41', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { mailed: false, etag: 'gespeichert' } });
  });
  await page.goto('/leitendenbereich/belege/');
  const open = async () => {
    await page.getByRole('button', { name: /REWE/ }).first().click();
    return page.getByRole('dialog', { name: 'Beleg von REWE' });
  };
  let dialog = await open();
  const paidBy = dialog.getByLabel('Ausgelegt von');
  // Paid out of the demo user's pocket: the own Auslage, no name to type
  await expect(
    dialog.getByRole('radio', { name: 'Mit meinem Geld – bitte an mich auszahlen' })
  ).toBeChecked();
  await expect(paidBy).toBeHidden();

  await dialog
    .getByRole('radio', { name: 'Jemand anderes hat ausgelegt – an diese Person auszahlen' })
    .check();
  await expect(paidBy).toHaveValue('');
  // The people of the module „Personen“ are suggested, any name can be typed
  await expect(dialog.locator('#bl-paid-by-suggestions option').first()).toBeAttached();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    dialog.getByText('Bitte angeben, wer das Geld ausgelegt hat.', { exact: true })
  ).toBeVisible();
  await paidBy.fill('Robin Gast');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sent.at(-1)).toMatchObject({ payout: true, paidBy: 'Robin Gast' });

  dialog = await open();
  await dialog.getByRole('radio', { name: 'Umbuchung aufs Sparbuch' }).check();
  await expect(paidBy).toBeHidden();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sent.at(-1)).toMatchObject({ payout: true, paidBy: 'Sparbuch' });

  dialog = await open();
  await dialog.getByRole('radio', { name: 'Mit Stammeskarte / aus der Kasse' }).check();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sent.at(-1)).toMatchObject({ payout: false, paidBy: '' });

  // Sam's Auslage, submitted by Sam: someone else's, with the name
  await page.getByRole('button', { name: /Deutsche Bahn/ }).click();
  const bahn = page.getByRole('dialog', { name: 'Beleg von Deutsche Bahn' });
  await expect(
    bahn.getByRole('radio', { name: 'Jemand anderes hat ausgelegt – an diese Person auszahlen' })
  ).toBeChecked();
  await expect(bahn.getByLabel('Ausgelegt von')).toHaveValue('Sam Muster');
});

test('an unclear Aktion asks once, keeps the receipt after a failed save and allows retry', async ({
  page,
}) => {
  const records = (await (
    await page.request.get('/api/intern/pflege/belege')
  ).json()) as StaffBeleg[];
  const receipt = records.find((item) => item.status === 'Eingereicht')!;
  let writes = 0;
  await page.route(`**/api/intern/pflege/belege/${receipt.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    writes++;
    if (writes === 1) await route.fulfill({ status: 500, json: {} });
    else await route.fulfill({ json: { mailed: false } });
  });
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button').filter({ hasText: receipt.shop }).first().click();
  const editor = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Aktion', { exact: true }) });
  await editor.getByLabel('Aktion', { exact: true }).fill('Herbst');
  await expect(
    editor.getByRole('button', { name: 'Wölflings-Herbstwochenende', exact: true })
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Aktion prüfen' });
  await expect(confirmation).toContainText('Herbst');
  expect(writes).toBe(0);
  await confirmation.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(editor.getByLabel('Aktion', { exact: true })).toHaveValue('Herbst');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await confirmation.getByRole('button', { name: 'So speichern', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Der Beleg wurde nicht gespeichert');
  await expect(editor.getByLabel('Aktion', { exact: true })).toHaveValue('Herbst');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(writes).toBe(2);
});

test('photo warnings and automatic reading share one verdict and adjustments are optional', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/belege/pruefung', (route) =>
    route.fulfill({ json: { available: true, check: knownCheck } })
  );
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 260;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 180, 260);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'kleiner-beleg.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  });
  await expect(
    dialog.getByText(/Das Foto ist zu klein und kann nicht eingereicht werden/)
  ).toBeVisible();
  await expect(dialog.getByLabel('Geschäft', { exact: true })).toHaveValue('');
  // The real API rejects the small image. Only a sufficiently large replacement is read.
  const largePhoto = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 900, 1200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'beleg.png',
    mimeType: 'image/png',
    buffer: Buffer.from(largePhoto, 'base64'),
  });
  await expect(dialog.getByLabel('Geschäft', { exact: true })).toHaveValue('Testmarkt');
  const verdict = dialog.getByRole('note').filter({ hasText: 'Foto prüfen' });
  await expect(verdict).toHaveCount(1);
  await expect(verdict).toContainText('unscharf');
  await expect(verdict).toContainText('Angaben lesen');
  await expect(dialog.getByText(/vollständig und gut lesbar/)).toHaveCount(0);
  // The tools of the photo are at hand and big enough to tap
  const grey = dialog.getByRole('group', { name: /^Farben/ }).getByRole('button', {
    name: 'Graustufen',
  });
  await expect(grey).toBeVisible();
  for (const tool of [grey, dialog.getByRole('button', { name: 'Nach rechts drehen' })]) {
    expect((await tool.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
});

test('the photo is rotated, mirrored, cropped and reset with the tools, one picture at a time', async ({
  page,
}, testInfo) => {
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  // A white receipt on a dark table, upright
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#333';
    context.fillRect(0, 0, 900, 1200);
    context.fillStyle = '#fff';
    context.fillRect(150, 150, 600, 900);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png')
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'beleg.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  const preview = dialog.getByAltText('Vorschau des Fotos');
  const size = async () => {
    const width = Number(await preview.getAttribute('width'));
    const height = Number(await preview.getAttribute('height'));
    return { width, height };
  };
  // Found and cropped to the receipt: upright, only the cropped picture is shown
  await expect(preview).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveCount(1);
  const before = await size();
  expect(before.height).toBeGreaterThan(before.width);

  const reset = dialog.getByRole('button', { name: 'Auf das Originalfoto zurücksetzen' });
  await expect(reset).toBeEnabled();
  await dialog.getByRole('button', { name: 'Nach rechts drehen' }).click();
  await expect.poll(size).toEqual({ width: before.height, height: before.width });
  await dialog.getByRole('button', { name: 'Nach links drehen' }).click();
  await expect.poll(size).toEqual(before);
  const src = await preview.getAttribute('src');
  await dialog.getByRole('button', { name: 'Horizontal spiegeln' }).click();
  await expect(preview).not.toHaveAttribute('src', src!);
  await dialog.getByRole('button', { name: 'Vertikal spiegeln' }).click();

  // The crop tool shows the uncropped picture with its corners, and nothing else
  await dialog.getByRole('button', { name: 'Zuschneiden', exact: true }).click();
  const corners = dialog.getByRole('group', { name: 'Ecken des Belegs' });
  await expect(corners).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(dialog.getByRole('toolbar', { name: 'Foto bearbeiten' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('zuschneiden.png') });
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).first().click();
  await expect.poll(size).toEqual(before);
  await dialog.getByRole('button', { name: 'Zuschneiden', exact: true }).click();
  await dialog
    .getByRole('button', { name: /Ecke oben links verschieben/ })
    .press('Shift+ArrowRight');
  await dialog.getByRole('button', { name: 'Zuschneiden fertig' }).click();
  await expect(corners).toHaveCount(0);
  await expect.poll(async () => (await size()).width).toBeLessThan(before.width);

  const colours = dialog.getByRole('group', { name: /^Farben/ });
  await colours.getByRole('button', { name: 'Graustufen' }).click();
  await expect(colours.getByRole('button', { name: 'Graustufen' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.screenshot({ path: testInfo.outputPath('werkzeuge.png') });

  // Back to the photo as it was chosen
  await reset.click();
  await expect.poll(size).toEqual({ width: 900, height: 1200 });
  await expect(colours.getByRole('button', { name: 'Original' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(reset).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test('the photo tips wait behind the (i) next to the photo field', async ({ page }) => {
  await page.goto('/leitendenbereich/belege');
  await expect(page.getByRole('link', { name: 'Eigenbeleg erstellen' })).toBeVisible();
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const tips = dialog.getByText(/Scan-Funktion des Handys/);
  await expect(tips).toBeHidden();
  await dialog.getByRole('button', { name: 'Erklärung zu Foto des Belegs' }).click();
  await expect(tips).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('choosing a suggestion on an existing receipt asks before discarding the change', async ({
  page,
}) => {
  const records = (await (
    await page.request.get('/api/intern/pflege/belege')
  ).json()) as StaffBeleg[];
  const receipt = records.find((item) => item.status === 'Eingereicht')!;
  await page.route('**/api/intern/pflege/belege', (route) =>
    route.fulfill({
      json: records.map((item) => (item.id === receipt.id ? { ...item, aktion: 'Herbst' } : item)),
    })
  );
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button').filter({ hasText: receipt.shop }).first().click();
  const editor = page
    .getByRole('dialog')
    .filter({ has: page.getByLabel('Aktion', { exact: true }) });
  await editor.getByRole('button', { name: 'Wölflings-Herbstwochenende', exact: true }).click();
  await editor.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
  await expect(editor.getByLabel('Aktion', { exact: true })).toHaveValue(
    'Wölflings-Herbstwochenende'
  );
});

for (const decision of [
  { label: 'Annehmen', source: 'Eingereicht', target: 'Angenommen' },
  { label: 'Ablehnen', source: 'Eingereicht', target: 'Abgelehnt' },
  { label: 'Erneut einreichen', source: 'Abgelehnt', target: 'Eingereicht' },
]) {
  test(`an unknown Aktion confirmation keeps the action name ${decision.label}`, async ({
    page,
  }) => {
    const records = (await (
      await page.request.get('/api/intern/pflege/belege')
    ).json()) as StaffBeleg[];
    const receipt = records.find((item) => item.status === decision.source)!;
    let savedStatus: string | undefined;
    await page.route(`**/api/intern/pflege/belege/${receipt.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      savedStatus = route.request().postDataJSON().status;
      await route.fulfill({ json: { mailed: false } });
    });
    await page.goto('/leitendenbereich/belege');
    await page.getByRole('button', { name: /^Alle/ }).click();
    await page.getByRole('button').filter({ hasText: receipt.shop }).first().click();
    const editor = page
      .getByRole('dialog')
      .filter({ has: page.getByLabel('Aktion', { exact: true }) });
    await editor.getByLabel('Aktion', { exact: true }).fill('Herbst');
    if (decision.target === 'Abgelehnt')
      await editor
        .getByLabel('Bemerkung der Kasse', { exact: false })
        .fill('Bitte den vollständigen Beleg fotografieren.');
    await editor.getByRole('button', { name: decision.label, exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Aktion prüfen' });
    await expect(
      confirmation.getByRole('button', { name: decision.label, exact: true })
    ).toBeVisible();
    await confirmation.getByRole('button', { name: decision.label, exact: true }).click();
    await expect(editor).toBeHidden();
    expect(savedStatus).toBe(decision.target);
  });
}
