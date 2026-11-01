import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('the plan shows as a grid over the whole width, dishes are typed into a meal', async ({
  page,
}) => {
  await anlegen(page, 'E2E Kalender');
  await page.getByRole('button', { name: 'Kalender' }).click();
  await expect(page.getByRole('button', { name: 'Kalender' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const kalender = page.getByRole('grid', { name: 'Plan als Kalender' });
  // The days as columns, the meals as rows with their names on the left
  await expect(kalender.getByRole('columnheader')).toHaveCount(3);
  await expect(kalender.getByRole('rowheader', { name: 'Mittagessen' })).toBeVisible();
  await expect(page.locator('[data-kalender="2_5"]')).toBeVisible();
  // On a wide screen two days share the width next to the list of dishes; on a phone a day keeps
  // room for its cards and the plan scrolls sideways, saying so
  const breite = (await kalender.getByRole('columnheader').nth(1).boundingBox())?.width ?? 0;
  if ((page.viewportSize()?.width ?? 0) >= 1024) expect(breite).toBeGreaterThan(300);
  else {
    expect(breite).toBeGreaterThanOrEqual(200);
    await expect(page.getByText('Weitere Tage siehst du, wenn du seitlich wischst')).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);

  // Arrow keys move between the cells; typing starts a dish, Enter creates and plans it
  const zelle = page.locator('[data-kalender="1_1"]');
  await zelle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-kalender="1_2"]')).toBeFocused();
  await page.keyboard.type('Nudeln');
  await expect(kalender.getByLabel('Gericht bei 1_2 Mittagessen')).toHaveValue('Nudeln');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nudeln angelegt und bei 1_2 eingeplant.').first()).toBeVisible();
  const karte = page.locator('[data-kalender="1_2"] [data-karte]');
  await expect(karte).toContainText('1_2_1');
  await expect(karte).toContainText('Portionen');
  await expect(karte).toContainText('noch ohne Zutaten');
  // The same name again plans the existing dish, with who is responsible
  await kalender.getByLabel('Gericht bei 1_2 Mittagessen').fill('nudeln');
  await kalender.getByLabel('Zuständig für das Gericht bei 1_2').fill('Kim Küche');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nudeln bei 1_2 eingeplant.').first()).toBeVisible();
  await expect(karte).toHaveCount(2);
  await expect(karte.nth(1)).toContainText('Kim Küche');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-kalender="1_2"]')).toBeFocused();

  // Alt+arrow moves a dish to the same meal of the next day
  await kalender.getByRole('button', { name: '1_2_2 Nudeln öffnen' }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByText('Nudeln nach 2_2 verschoben.').first()).toBeVisible();
  await expect(page.locator('[data-kalender="2_2"] [data-karte]')).toHaveCount(1);

  // Dragging: a planned dish to another meal, and a dish from the list of all dishes
  await page
    .locator('[data-kalender="2_2"] [data-karte]')
    .dragTo(page.locator('[data-kalender="2_4"]'));
  await expect(page.locator('[data-kalender="2_4"] [data-karte]')).toHaveCount(1);
  await expect(page.locator('[data-kalender="2_2"] [data-karte]')).toHaveCount(0);
  if (await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)) {
    // On a phone the list of all dishes is folded and fingers do not drag: a tap on „+ Gericht“,
    // always shown there, types the dish in
    await kalender.getByRole('button', { name: 'Gericht eintragen bei 1_1 Frühstück' }).tap();
    await kalender.getByLabel('Gericht bei 1_1 Frühstück').fill('Nudeln');
    await kalender.getByLabel('Gericht bei 1_1 Frühstück').press('Enter');
    await expect(page.getByText('Nudeln bei 1_1 eingeplant.').first()).toBeVisible();
  } else {
    await page
      .getByRole('list', { name: 'Alle Gerichte' })
      .getByText('Nudeln')
      .dragTo(page.locator('[data-kalender="1_1"]'));
  }
  await expect(page.locator('[data-kalender="1_1"] [data-karte]')).toHaveCount(1);

  // The checkbox ticks off „gekocht“ in one click
  await kalender.getByRole('checkbox', { name: '1_1_1 Nudeln gekocht' }).check();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  await expect(page.locator('[data-kalender="1_1"] [data-karte]')).toContainText('gekocht');

  // The name opens the dish in the area of the dishes
  await kalender.getByRole('button', { name: '1_1_1 Nudeln öffnen' }).click();
  await expect(page.getByRole('tab', { name: 'Gerichte' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(
    page.getByRole('tabpanel', { name: 'Gerichte' }).getByLabel('Name', { exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole('tabpanel', { name: 'Gerichte' }).getByLabel('Name', { exact: true })
  ).toHaveValue('Nudeln');

  // The choice stays after a reload; the list is one tap away
  await page.reload();
  await expect(page.getByRole('grid', { name: 'Plan als Kalender' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(page.getByRole('grid', { name: 'Plan als Kalender' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toContainText('Nudeln');
});

test('a dish typed into a meal stays when switching views, after a failed save and on leaving', async ({
  page,
}) => {
  await anlegen(page, 'E2E Kalender Entwurf');
  await page.getByRole('button', { name: 'Kalender' }).click();
  const kalender = page.getByRole('grid', { name: 'Plan als Kalender' });
  const liste = page.locator('[data-mahlzeit="1_2"]');

  // Typed in the calendar, the draft is there in the list and back in the calendar
  await page.locator('[data-kalender="1_2"]').focus();
  await page.keyboard.press('Enter');
  await kalender.getByLabel('Gericht bei 1_2 Mittagessen').fill('Grillgemüse');
  await kalender.getByLabel('Zuständig für das Gericht bei 1_2').fill('Rover');
  await page.getByRole('button', { name: 'Liste' }).click();
  await expect(liste.getByLabel('Gericht bei 1_2 Mittagessen')).toHaveValue('Grillgemüse');
  await expect(liste.getByLabel('Zuständig für das Gericht bei 1_2')).toHaveValue('Rover');
  await page.getByRole('button', { name: 'Kalender' }).click();
  await expect(kalender.getByLabel('Gericht bei 1_2 Mittagessen')).toHaveValue('Grillgemüse');

  // A failed save keeps it, also through switching
  await page.route('**/api/essensplanung/planung/gerichte', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'Kaputt' } })
      : route.continue()
  );
  await kalender.getByLabel('Gericht bei 1_2 Mittagessen').press('Enter');
  await expect(page.getByText(/Das hat nicht geklappt|Kaputt/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Liste' }).click();
  await page.getByRole('button', { name: 'Kalender' }).click();
  await expect(kalender.getByLabel('Gericht bei 1_2 Mittagessen')).toHaveValue('Grillgemüse');
  await expect(kalender.getByLabel('Zuständig für das Gericht bei 1_2')).toHaveValue('Rover');

  // Leaving the page asks first
  await page.getByRole('link', { name: 'Impressum' }).first().click();
  const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(frage).toBeVisible();
  await frage.getByRole('button', { name: 'Weiter bearbeiten' }).click();

  // Saved once it works again
  await page.unroute('**/api/essensplanung/planung/gerichte');
  await kalender.getByLabel('Gericht bei 1_2 Mittagessen').press('Enter');
  await expect(page.locator('[data-kalender="1_2"] [data-karte]')).toContainText('Grillgemüse');
  await expect(page.locator('[data-kalender="1_2"] [data-karte]')).toContainText('Rover');
});
