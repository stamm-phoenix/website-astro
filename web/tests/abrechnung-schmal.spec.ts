import { resetAccountingInputs } from './abrechnung-helpers';
import { test, expect, expectNoHorizontalOverflow, expectWithinWindowWidth } from './fixtures';

test.beforeEach(async ({ page }) => {
  await resetAccountingInputs(page);
});

test('on a phone every tab of the Abrechnung is on screen', async ({ page }) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  for (const tab of await tabs.all()) await expectWithinWindowWidth(page, tab);
  for (const tab of await tabs.all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('tab', { name: 'Leihgebühren' }).click();
  await expect(page.getByRole('tab', { name: 'Leihgebühren' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expectNoHorizontalOverflow(page);
});

test('on a phone the role and the grant of a participant are visible without scrolling sideways', async ({
  page,
}) => {
  await page.goto(
    '/leitendenbereich/abrechnung/evt_HikeMangfall?kostenstelle=cun_Hike&tab=teilnehmende'
  );
  const teilnehmende = page.getByTestId('tn-gruppe-teilnehmende');
  const rolle = teilnehmende.getByRole('combobox', { name: /^Rolle / }).first();
  const name = ((await rolle.getAttribute('aria-label')) ?? '').replace(/^Rolle /, '');
  const row = page.locator('tr', {
    has: page.getByRole('combobox', { name: `Rolle ${name}`, exact: true }),
  });
  await expectWithinWindowWidth(page, rolle);
  await expectWithinWindowWidth(page, row.getByLabel(`PLZ ${name}`));
  const zuschuss = row.getByTestId('zuschuss-grund');
  await expect(zuschuss).toHaveText(/^(ja|nein)/);
  await expect(zuschuss.locator('..')).toHaveText(/^Bezuschusst\s*(ja|nein)/);
  await expectWithinWindowWidth(page, zuschuss);
  expect(
    (await row.getByRole('checkbox').locator('..').boundingBox())!.height
  ).toBeGreaterThanOrEqual(44);

  // The controls still work in the stacked layout
  await rolle.selectOption('Betreuer*in');
  await expect(
    page.getByTestId('tn-gruppe-betreuer').getByRole('combobox', { name: `Rolle ${name}` })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

