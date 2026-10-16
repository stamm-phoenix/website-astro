import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the main task and reload sit with the page introduction', async ({ page }) => {
  await page.goto('/leitendenbereich/sammelbestellungen');
  const create = page.getByRole('button', { name: 'Neue Sammelbestellung', exact: true });
  await expect(create).toBeEnabled();
  const head = page.locator('.ui-pagehead');
  await expect(head.getByRole('heading', { level: 1 })).toHaveText('Sammelbestellungen');
  await expect(
    head.getByRole('button', { name: 'Neue Sammelbestellung', exact: true })
  ).toBeVisible();
  const reload = head.getByRole('button', { name: 'Neu laden', exact: true });
  await reload.click();
  await expect(create).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
