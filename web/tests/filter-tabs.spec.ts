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
