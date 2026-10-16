import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the Dispo pin says whether the team is held and keeps it when recalculating', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/nikolaus-dispo');
  const stop = page
    .locator('.stop-card')
    .filter({ has: page.getByRole('button', { name: /^Team festhalten/ }) })
    .first();
  await expect(stop).toBeVisible();
  const family = await stop.locator('p.font-semibold').first().textContent();
  const team = await stop.getByRole('combobox').inputValue();
  const held = page.locator('.stop-card').filter({ hasText: family! });
  await stop.getByRole('button', { name: /^Team festhalten/ }).click();
  await expect(held.getByRole('button', { name: /^Team festgehalten/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: 'Neu berechnen', exact: true }).click();
  await expect(held.getByRole('combobox')).toHaveValue(team);
  await expect(held.getByRole('button', { name: /^Team festgehalten/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await held.getByRole('button', { name: /^Team festgehalten/ }).click();
  await expect(held.getByRole('button', { name: /^Team festhalten/ })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expectNoHorizontalOverflow(page);
});

test('the compact assignment pin announces its actual state and has a touch target', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/nikolaus-helfende?ansicht=einteilung');
  const pin = page.getByRole('button', { name: /^Posten festhalten/ }).first();
  await expect(pin).toBeVisible();
  const label = await pin.getAttribute('aria-label');
  const size = await pin.boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await pin.click();
  await expect(
    page.getByRole('button', {
      name: label!.replace('Posten festhalten', 'Posten festgehalten'),
      exact: true,
    })
  ).toHaveAttribute('aria-pressed', 'true');
});
