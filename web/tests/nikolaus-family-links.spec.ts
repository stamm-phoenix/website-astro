import { test, expect } from './fixtures';

test('the family name opens booking details without a separate Details column', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The mobile list already opens through its family row.'
  );
  await page.goto('/leitendenbereich/nikolaus?ansicht=liste');
  await expect(page.getByRole('button', { name: 'Familie Huber', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Familie Huber', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Familie Huber', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Details schließen', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Details zu Familie/ })).toHaveCount(0);
});
