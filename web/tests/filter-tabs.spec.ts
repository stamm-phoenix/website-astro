import sharp from 'sharp';
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';

/** Longest unbroken run of underline-red pixels in any row of the element's screenshot. */
async function longestUnderline(button: Locator): Promise<{ run: number; width: number }> {
  const png = await button.screenshot({ animations: 'disabled', scale: 'css' });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let longest = 0;
  for (let y = 0; y < info.height; y++) {
    let run = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      // Accent #810a1a in the light theme
      const red = data[i] > 100 && data[i] < 160 && data[i + 1] < 50 && data[i + 2] < 60;
      run = red ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  return { run: longest, width: info.width };
}

test('the underline of a filter runs under the label and the count', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/leitendenbereich/belege/');
  const filters = page.getByRole('group', { name: 'Nach Status filtern' });
  const pressed = filters.locator('button[aria-pressed="true"]');
  await expect(pressed).toContainText('(');
  const { run, width } = await longestUnderline(pressed);
  expect(run).toBeGreaterThanOrEqual(width - 2);
});

test('Abrechnung, Sammelbestellungen and Leitende use the shared filter buttons', async ({
  page,
}) => {
  const selectors = [
    { url: '/leitendenbereich/abrechnung', group: 'Aktionen auswählen', button: 'Aktuell' },
    {
      url: '/leitendenbereich/sammelbestellungen',
      group: 'Sammelbestellungen auswählen',
      button: 'Aktuell',
    },
    { url: '/leitendenbereich/leitende', group: 'Nach Team filtern', button: 'Alle' },
  ];
  for (const selector of selectors) {
    await page.goto(selector.url);
    const button = page
      .getByRole('group', { name: selector.group })
      .getByRole('button', { name: selector.button, exact: true });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveClass(/filter-tab/);
    expect((await button.boundingBox())?.height, selector.url).toBeGreaterThanOrEqual(44);
  }
});

test('the two rows in Anwesenheit say what they choose', async ({ page }) => {
  await page.goto('/leitendenbereich/anwesenheit');
  for (const name of ['Stufe', 'Ansicht']) {
    await expect(page.getByText(`${name}:`, { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: `${name}:`, exact: true })).toBeVisible();
  }
  await expect(
    page
      .getByRole('group', { name: 'Ansicht:', exact: true })
      .getByRole('button', { name: 'Erfassen' })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the chosen option stays marked in contrast mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/leitendenbereich/anwesenheit');
  for (const name of ['Stufe:', 'Ansicht:']) {
    const group = page.getByRole('group', { name, exact: true });
    const outline = (pressed: boolean) =>
      group
        .locator(`button[aria-pressed="${pressed}"]`)
        .first()
        .evaluate((button) => getComputedStyle(button).outlineStyle);
    expect(await outline(true), name).toBe('solid');
    expect(await outline(false), name).toBe('none');
  }
});
