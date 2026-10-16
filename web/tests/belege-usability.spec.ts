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
    dialog.getByText('Bitte auswählen, wie du bezahlt hast.', { exact: true })
  ).toBeVisible();
  await clubMoney.check();
  await expect(clubMoney).toBeChecked();
  await expect(ownMoney).not.toBeChecked();
  await expectNoHorizontalOverflow(page);
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
  await expect(dialog.getByLabel('Geschäft', { exact: true })).toHaveValue('Testmarkt');
  const verdict = dialog.getByRole('note').filter({ hasText: 'Automatische Prüfung:' });
  await expect(verdict).toHaveCount(1);
  await expect(verdict).toContainText('sehr klein');
  await expect(verdict).toContainText('Angaben lesen');
  await expect(dialog.getByText(/vollständig und gut lesbar/)).toHaveCount(0);
  const options = dialog.getByRole('radio', {
    name: 'Graustufen',
    exact: true,
    includeHidden: true,
  });
  await expect(options).toBeHidden();
  await dialog.getByText('Foto anpassen …', { exact: true }).click();
  await expect(options).toBeVisible();
  const rowHeight = await options.evaluate(
    (input) => input.closest('label')!.getBoundingClientRect().height
  );
  expect(rowHeight).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
});

test('receipt help starts collapsed when receipts already exist and the main action comes first', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/belege');
  const help = page
    .locator('details')
    .filter({ has: page.getByText("So geht's", { exact: true }) });
  await expect(help).toBeVisible();
  await expect(help).not.toHaveAttribute('open');
  const action = page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first();
  expect((await action.boundingBox())!.y).toBeLessThan((await help.boundingBox())!.y);
  await help.locator('summary').click();
  await expect(help.getByText(/Scan-Funktion deines Handys/)).toBeVisible();
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
