import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the rich text field has the same field surface and usable touch tools', async ({
  page,
  isMobile,
}) => {
  await page.goto('/leitendenbereich/blog/beitrag');
  const editor = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(editor).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Titel', exact: true });
  const fieldColor = await title.evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(editor).toHaveCSS('background-color', fieldColor);
  if (isMobile) {
    const tool = page.getByRole('button', { name: 'Fett', exact: true });
    const size = await tool.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(40);
    expect(size?.height).toBeGreaterThanOrEqual(40);
  }
  await editor.fill('Ein gemeinsamer Text.');
  await expect(editor).toContainText('Ein gemeinsamer Text.');
  await expectNoHorizontalOverflow(page);
});
