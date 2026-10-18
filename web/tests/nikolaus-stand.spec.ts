import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the Dispo says when the visits in its plan were loaded', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' });
  await page.goto('/leitendenbereich/nikolaus-dispo');
  const timestamp = page.getByText('Stand: 14:00 Uhr', { exact: true });
  await expect(timestamp).toBeVisible();
  await timestamp.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('dispo-stand.png') });
});
