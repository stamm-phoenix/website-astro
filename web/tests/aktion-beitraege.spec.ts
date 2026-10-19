import { test, expect } from './fixtures';
import { formatName, personStatus } from '../src/lib/campflowFields';
import type { AktionBeitraegeData, CampflowEventDetail } from '../src/lib/types';

const EVENT = 'evt_Sola26';
const PAGE = `/leitendenbereich/aktionen/aktion?id=${EVENT}`;

test('the participant list shows Beitrag, payment status and Verwendungszweck', async ({
  page,
  request,
}) => {
  const detail = (await (
    await request.get(`/api/intern/aktionen/${EVENT}`)
  ).json()) as CampflowEventDetail;
  const beitraege = (await (
    await request.get(`/api/intern/aktionen/${EVENT}/beitraege`)
  ).json()) as AktionBeitraegeData;
  const offen = detail.persons.find(
    (p) =>
      personStatus(p) !== 'cancelled' &&
      beitraege.persons[p.id]?.some((fee) => fee.status === 'unpaid')
  );
  expect(offen, 'the demo Aktion has someone who has not paid').toBeDefined();
  const fee = beitraege.persons[offen!.id][0];

  await page.goto(PAGE);
  await expect(page.getByTestId('aktion-beitraege-stand')).toContainText('Beiträge: Stand');
  await expect(page.getByText('Beitrag offen', { exact: true })).toBeVisible();

  const isMobile = (page.viewportSize()?.width ?? 0) < 768;
  const entry = isMobile
    ? page.getByRole('listitem').filter({ hasText: formatName(offen!) })
    : page.getByRole('row').filter({ hasText: formatName(offen!) });
  if (!isMobile) {
    await expect(page.getByRole('columnheader', { name: 'Beitrag', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Verwendungszweck' })).toBeVisible();
  }
  await expect(entry).toContainText('Nicht bezahlt');
  await expect(entry).toContainText(fee.reference);

  // One click copies the Verwendungszweck and says so, without opening the details
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await entry.getByRole('button', { name: `Verwendungszweck ${fee.reference} kopieren` }).click();
  await expect(entry.getByRole('status')).toHaveText('Kopiert');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fee.reference);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Sorting by Beitrag puts open Beiträge first
  if (!isMobile) {
    await page.getByRole('button', { name: 'Beitrag', exact: true }).click();
    await expect(page.getByRole('row').nth(1)).toContainText(/Nicht bezahlt|Teilweise bezahlt/);
  }

  await entry
    .getByRole('button', { name: isMobile ? new RegExp(formatName(offen!)) : /^Details/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Beitrag' })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: `Verwendungszweck ${fee.reference} kopieren` })
  ).toBeVisible();
  await expect(dialog).toContainText('Nicht bezahlt');
});

test('the participants stay usable when CampFlow does not deliver the Beiträge', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/intern/aktionen/*/beitraege*', async (route) => {
    if (!fail) return route.continue();
    await route.fulfill({
      status: 502,
      json: {
        error: 'BEITRAEGE_UNAVAILABLE',
        code: 'BEITRAEGE_UNAVAILABLE',
        message: 'Die Beiträge der Teilnehmenden konnten nicht aus CampFlow geladen werden.',
      },
    });
  });

  await page.goto(PAGE);
  const alert = page.getByRole('alert').filter({ hasText: 'Beiträge fehlen' });
  await expect(alert).toContainText('konnten nicht aus CampFlow geladen werden');
  await expect(page.getByText('Personen angezeigt')).toBeVisible();

  fail = false;
  await alert.getByRole('button', { name: 'Beiträge erneut laden' }).click();
  await expect(page.getByTestId('aktion-beitraege-stand')).toBeVisible();
  await expect(alert).toHaveCount(0);
});
