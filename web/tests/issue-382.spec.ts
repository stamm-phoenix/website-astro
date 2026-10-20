import { resetAccountingInputs } from './abrechnung-helpers';
import { test, expect, answerConfirm, expectNoHorizontalOverflow } from './fixtures';

test.beforeEach(async ({ page }) => {
  await resetAccountingInputs(page);
});

test.use({ viewport: { width: 390, height: 844 } });

test('an attendance note is protected when switching group, date and view', async ({ page }) => {
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByLabel('Datum', { exact: true }).fill('2026-09-10');
  const note = page.getByLabel(/Was habt ihr gemacht/);
  await note.fill('Ungespeicherte Schnitzeljagd');
  for (const change of [
    () => page.getByRole('button', { name: 'Jungpfadfinder', exact: true }).click(),
    () => page.getByLabel('Datum', { exact: true }).fill('2026-09-24'),
    () => page.getByRole('button', { name: 'Verlauf & Statistik' }).click(),
  ]) {
    await change();
    await answerConfirm(page, 'Ungespeicherte Eingaben verwerfen?', 'Weiter bearbeiten');
    await expect(note).toHaveValue('Ungespeicherte Schnitzeljagd');
  }
  await page.getByRole('button', { name: 'Jungpfadfinder', exact: true }).click();
  await answerConfirm(page, 'Ungespeicherte Eingaben verwerfen?', 'Eingaben verwerfen');
  await expect(note).not.toHaveValue('Ungespeicherte Schnitzeljagd');
});

test('published blog titles, dates and controls have separate space on phones', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/blog');
  const rows = page.locator('main ul.divide-y > li');
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    const title = row.locator('a.font-semibold');
    const box = await title.boundingBox();
    expect(box!.width).toBeGreaterThan(180);
    await expect(title).toHaveCSS('text-overflow', 'clip');
  }
  await expectNoHorizontalOverflow(page);
});

test('full Nikolaus days explain availability before families fill a form', async ({ page }) => {
  await page.route('**/api/nikolaus/slots', async (route) => {
    const response = await route.fetch();
    const slots = await response.json();
    await route.fulfill({ json: slots.map((slot: object) => ({ ...slot, available: 0 })) });
  });
  await page.goto('/nikolaus');
  await expect(
    page.getByRole('heading', { name: 'Alle Termine sind derzeit ausgebucht' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Termin verbindlich anfragen' })).toBeDisabled();
  await expect(page.locator('#nikolaus-familyName')).toBeDisabled();
});

test('turning off seasonal modules asks before saving and leaves save reachable', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/nikolaus-steuerung');
  const checkbox = page.getByLabel(/Nikolausverwaltung aktiv/);
  await checkbox.uncheck();
  const save = page.getByRole('button', { name: 'Einstellungen speichern' });
  await save.click();
  await answerConfirm(page, 'Nikolausverwaltung für alle ausschalten?', 'Weiter bearbeiten');
  await expect(save).toBeEnabled();
  await expect(page.getByText(/verschwinden Anmeldungen/)).toBeVisible();
  await checkbox.check();
  await expect(save).toBeDisabled();
});

test('the team action selects the group in the leaders list', async ({ page }) => {
  await page.goto('/leitendenbereich/gruppenstunden');
  await page.getByRole('link', { name: 'Team bearbeiten' }).first().click();
  await expect(page).toHaveURL(/team=/);
  await expect(page.getByRole('button', { name: 'Wölflinge', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('personal accounting inputs survive another browser and reject stale writes', async ({
  page,
  context,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const toggle = page.getByRole('checkbox', { name: /Zusatztag/ });
  await expect(toggle).toBeVisible();
  const other = await context.newPage();
  await other.goto(page.url());
  const otherToggle = other.getByRole('checkbox', { name: /Zusatztag/ });
  await expect(otherToggle).toBeVisible();
  await toggle.setChecked(!(await toggle.isChecked()));
  await page.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect(page.getByTestId('eingaben-ablage')).toContainText(
    'Auf allen deinen Geräten verfügbar'
  );
  await otherToggle.setChecked(!(await otherToggle.isChecked()));
  await other.getByRole('button', { name: 'Eingaben speichern' }).click();
  await expect(other.getByTestId('eingaben-ablage')).toContainText(
    'Hier wurde nichts überschrieben'
  );
  await expect(otherToggle).toBeChecked();
  // Clean both page guards and the persisted demo draft.
  await other.getByRole('button', { name: 'Gespeicherte Fassung laden' }).click();
  await answerConfirm(other, 'Gespeicherte Eingaben laden?', 'Gespeicherte Fassung laden');
  await expect(other.getByRole('button', { name: 'Eingaben speichern' })).toBeDisabled();
  await other.close();
  await page.getByRole('button', { name: 'Eingaben zurücksetzen' }).click();
  await answerConfirm(page, 'Eingaben zurücksetzen?', 'Eingaben zurücksetzen');
  await expect(page.getByText('Eingaben zurückgesetzt.')).toBeVisible();
});

test('correcting receipt fields clears their outdated errors immediately', async ({ page }) => {
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  await dialog.getByRole('button', { name: 'Einreichen', exact: true }).click();
  await expect(dialog.getByText('Bitte das Geschäft angeben.')).toBeVisible();
  await expect(dialog.getByText('Bitte einen Betrag wie 12,34 angeben.')).toBeVisible();
  await dialog.getByLabel('Geschäft', { exact: true }).fill('Testladen');
  await dialog.getByLabel('Betrag in €').fill('12,34');
  await expect(dialog.getByText('Bitte das Geschäft angeben.')).toHaveCount(0);
  await expect(dialog.getByText('Bitte einen Betrag wie 12,34 angeben.')).toHaveCount(0);
});

test('normal laptops show the main navigation and the dark Nikolaus banner has readable contrast', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menü öffnen', exact: true })).toBeHidden();
  const banner = page.getByRole('region', { name: 'Jetzt Termin mit dem Nikolaus ausmachen!' });
  const contrast = await banner.evaluate((element) => {
    function luminance(value: string): number {
      const channels = value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    const background = luminance(getComputedStyle(element).backgroundColor);
    const foreground = luminance(getComputedStyle(element.querySelector('p')!).color);
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await expectNoHorizontalOverflow(page);
});
