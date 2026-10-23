import { test, expect, expectNoHorizontalOverflow } from './fixtures';

// The suggestion fields of the Leitendenbereich (#418), one place per source of suggestions:
// people, Aktionen from CampFlow, the FAQ themes and the Nikolaus Merkmale.

test('people are suggested under „Ausgelegt von“ and picked by tap', async ({ page }) => {
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  await dialog
    .getByRole('radio', { name: 'Jemand anderes hat ausgelegt – an diese Person auszahlen' })
    .check();
  const paidBy = dialog.getByRole('combobox', { name: 'Ausgelegt von' });
  const list = dialog.getByRole('listbox', { name: 'Person auswählen' });

  // Without typing the list already offers names, also on a phone
  await paidBy.click();
  await expect(list.getByRole('option').first()).toBeVisible();
  await expect(paidBy).toHaveAttribute('aria-expanded', 'true');

  // Any part of the name, in any case
  await paidBy.fill('LEITERIN');
  const lea = list.getByRole('option', { name: 'Lea Leiterin', exact: true });
  await expect(lea).toBeVisible();
  await expect(list.getByRole('option', { name: 'Max Muster', exact: true })).toBeHidden();
  await expect(lea.locator('mark')).toHaveText('Leiterin');
  const box = await lea.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Above the keyboard: inside the visible part of the screen
  const visible = await page.evaluate(() => window.visualViewport?.height ?? window.innerHeight);
  expect(box!.y + box!.height).toBeLessThanOrEqual(visible);
  await expectNoHorizontalOverflow(page);

  await lea.click();
  await expect(paidBy).toHaveValue('Lea Leiterin');
  await expect(paidBy).toBeFocused();
  await expect(list).toBeHidden();

  // A name that is not suggested is kept as typed
  await paidBy.fill('Robin Gast');
  await expect(list).toBeHidden();
  await paidBy.press('Tab');
  await expect(paidBy).toHaveValue('Robin Gast');
});

test('Aktionen are suggested in the Eigenbeleg after loading and picked by keyboard', async ({
  page,
}) => {
  let release = (): void => {};
  const loaded = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/aktionen', async (route) => {
    await loaded;
    await route.fallback();
  });
  await page.goto('/leitendenbereich/eigenbeleg');
  const anlass = page.getByRole('combobox', { name: 'Aktion oder Zweck' });
  const list = page.getByRole('listbox', { name: 'Aktion auswählen' });
  await anlass.click();
  await expect(page.getByText('Vorschläge werden geladen …', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText('Vorschläge werden geladen …', { exact: true })).toBeHidden();

  await anlass.fill('lager');
  await expect(list.getByRole('option', { name: 'Sommerlager 2026 Oberjoch' })).toBeVisible();
  await expect(list.getByRole('option', { name: 'Pfingstlager 2027 am Chiemsee' })).toBeVisible();
  const first = (await list.getByRole('option').first().textContent())!.trim();

  await anlass.press('ArrowDown');
  await expect(anlass).toHaveAttribute('aria-activedescendant', /-option-0$/);
  await anlass.press('Enter');
  await expect(anlass).toHaveValue(first);
  await expect(list).toBeHidden();

  // Escape closes the list and keeps the typed text
  await anlass.fill('Sommer');
  await expect(list).toBeVisible();
  await anlass.press('Escape');
  await expect(list).toBeHidden();
  await anlass.press('Enter');
  await expect(anlass).toHaveValue('Sommer');
});

test('the Aktion of a receipt can be typed when the Aktionen fail to load', async ({ page }) => {
  await page.route('**/api/intern/aktionen', (route) => route.fulfill({ status: 500, json: {} }));
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  const aktion = dialog.getByRole('combobox', { name: 'Aktion' });
  await aktion.fill('Gruppenstunde Wölflinge');
  await expect(aktion).toHaveValue('Gruppenstunde Wölflinge');
  await expect(aktion).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByText('Vorschläge werden geladen …')).toBeHidden();
});

test('FAQ themes are suggested and a new one can be typed', async ({ page }) => {
  await page.goto('/leitendenbereich/fragen-und-antworten');
  await page.getByRole('button', { name: 'Neue Frage', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Frage' });
  const thema = dialog.getByRole('combobox', { name: /Thema/ });
  const list = dialog.getByRole('listbox', { name: 'Thema auswählen' });

  await thema.fill('fahrt');
  await list.getByRole('option', { name: 'Lager und Fahrten', exact: true }).click();
  await expect(thema).toHaveValue('Lager und Fahrten');
  await expect(thema).toBeFocused();

  await thema.fill('Ganz neues Thema');
  await expect(list).toBeHidden();
  await expect(thema).toHaveValue('Ganz neues Thema');
});

test('Merkmale in use are suggested while typing and added by tap', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await page.getByRole('button', { name: /Familie Huber/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Familie Huber', exact: true });
  const input = dialog.getByRole('combobox', { name: 'Merkmale für die Einteilung', exact: true });
  const list = dialog.getByRole('listbox', { name: 'Merkmal auswählen' });

  await input.fill('UND');
  await list.getByRole('option', { name: 'Hund', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Hund entfernen', exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  // A Merkmal already added is not offered again
  await input.fill('hund');
  await expect(list).toBeHidden();

  // A comma takes the typed text over; Enter afterwards adds nothing highlighted before
  const chips = dialog.getByRole('button', { name: / entfernen$/ });
  await input.fill('n');
  await input.press('ArrowUp');
  await expect(input).toHaveAttribute('aria-activedescendant', /-option-\d+$/);
  const before = await chips.count();
  await input.press(',');
  await expect(dialog.getByRole('button', { name: 'n entfernen', exact: true })).toBeVisible();
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await input.press('Enter');
  await expect(chips).toHaveCount(before + 1);
});

test('field near the bottom moves up and keeps room for several suggestions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/leitendenbereich/eigenbeleg');
  const anlass = page.getByRole('combobox', { name: 'Aktion oder Zweck' });
  await anlass.evaluate((el) => {
    const top = el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 20;
    window.scrollTo({ top, behavior: 'instant' });
  });
  await anlass.click();
  await anlass.fill('e');
  const popup = page.locator('#eb-anlass-options').locator('..');
  await expect(popup).toBeVisible();
  await page.waitForTimeout(800);
  const box = (await popup.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(3 * 44);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
});
