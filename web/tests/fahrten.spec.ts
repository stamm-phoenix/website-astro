import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { formatName, personStatus } from '../src/lib/campflowFields';
import type { CampflowEventDetail } from '../src/lib/types';

const EVENT = 'evt_HikeMangfall';

/** Names of everyone in the plan of the shown direction, drivers and passengers, with and without seat. */
async function plannedNames(page: Page): Promise<string[]> {
  const plan = page.getByRole('region', { name: 'Planung' });
  return plan
    .getByRole('button', { name: /, ändern$/ })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.querySelector('span:nth-child(2)')?.textContent?.trim() ?? '')
    );
}

test('the Fahrten plan seats everyone once and keeps changes in the link', async ({
  page,
  request,
}) => {
  const detail = (await (
    await request.get(`/api/intern/aktionen/${EVENT}`)
  ).json()) as CampflowEventDetail;
  // Names of everyone who has not cancelled, sorted, to compare with the plan
  const active = detail.persons
    .filter((person) => personStatus(person) !== 'cancelled')
    .map(formatName)
    .sort();

  await page.goto(`/leitendenbereich/aktionen/fahrten?id=${EVENT}`);
  await expect(
    page.getByRole('heading', { name: 'Fahrten: Hike durchs Mangfalltal' })
  ).toBeVisible();
  await expect(page.getByLabel('Angebotene Plätze Hinfahrt')).toHaveValue('col_plaetze_hin');

  // Every participant who has not cancelled appears exactly once: as driver, passenger or without seat
  expect((await plannedNames(page)).sort()).toEqual(active);

  const cars = page.getByRole('region', { name: 'Planung' }).locator('ol > li');
  const passenger = cars.locator('ul button').first();
  const passengerName = (await passenger.locator('span').nth(1).textContent())?.trim() ?? '';
  await passenger.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ohne Platz' }).click();
  const withoutSeat = page.getByRole('region', { name: /Ohne Platz/ });
  await expect(withoutSeat.getByRole('button', { name: new RegExp(passengerName) })).toBeVisible();

  // The plan lives in the URL, so a reload (or a shared link) shows the same plan
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: /Ohne Platz/ })
      .getByRole('button', { name: new RegExp(passengerName) })
  ).toBeVisible();

  // A driver who does not want to drive is planned as passenger or without seat instead
  const driver = cars.first().locator(':scope > button');
  const driverName = (await driver.locator('span').nth(1).textContent())?.trim() ?? '';
  await driver.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fährt nicht' }).click();
  await expect(cars.locator(':scope > button', { hasText: driverName })).toHaveCount(0);
  expect((await plannedNames(page)).sort()).toEqual(active);

  // The Rückfahrt is planned on its own; there, too, everyone appears once
  await page
    .getByRole('group', { name: 'Fahrt' })
    .getByRole('button', { name: 'Rückfahrt' })
    .click();
  await expect(page.getByRole('button', { name: 'Änderungen verwerfen' })).toBeVisible();
  expect((await plannedNames(page)).sort()).toEqual(active);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Änderungen verwerfen' }).click();
  await expect(page.getByRole('button', { name: 'Änderungen verwerfen' })).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Fahrt' })
    .getByRole('button', { name: 'Hinfahrt' })
    .click();
  await expect(cars.first().locator(':scope > button')).toContainText(driverName);

  // Another seat field counts as a change too, and discarding brings back the guessed one
  const hinColumn = page.getByLabel('Angebotene Plätze Hinfahrt');
  await hinColumn.selectOption('col_plaetze_rueck');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Änderungen verwerfen' }).click();
  await expect(hinColumn).toHaveValue('col_plaetze_hin');
});
