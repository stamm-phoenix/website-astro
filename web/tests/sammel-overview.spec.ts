import { test, expect } from './fixtures';
test('campaign titles open the details without repeated archive labels or primary open buttons', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/sammelbestellungen');
  const title = page.locator('main h3 a').first();
  await expect(title).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Neue Sammelbestellung', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Archivstatus', { exact: true })).toHaveCount(0);
  const heading = await page
    .getByRole('heading', { name: 'Aktuelle Sammelbestellungen', exact: true })
    .boundingBox();
  expect(heading!.height).toBeLessThanOrEqual(1);
  await expect(page.getByRole('link', { name: /öffnen$/ })).toHaveCount(0);
  const url = await title.getAttribute('href');
  await title.click();
  await expect(page).toHaveURL(new RegExp(url! + '/?$'));
});
