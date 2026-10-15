import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { formatName } from '../src/lib/campflowFields';
import type { CampflowEventDetail } from '../src/lib/types';

const EVENT = 'evt_HikeMangfall';

/** Opens a detail dialog with the first visible button matching `name` and returns both. */
async function openDetails(
  page: Page,
  name: RegExp
): Promise<{ opener: Locator; dialog: Locator }> {
  const opener = page
    .locator('main')
    .getByRole('button', { name })
    .filter({ visible: true })
    .first();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return { opener, dialog };
}

/** Clicks the dimmed area in the top left corner, outside the dialog. */
async function clickBackdrop(page: Page): Promise<void> {
  await page.mouse.click(4, 4);
}

/** Drags a text selection from `start` onto the backdrop, e.g. to copy an address. */
async function selectOutward(page: Page, start: Locator): Promise<void> {
  const box = await start.boundingBox();
  if (!box) throw new Error('dialog content has no box');
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(4, 4, { steps: 4 });
  await page.mouse.up();
}

const DETAIL_DIALOGS = [
  {
    name: 'a CampFlow participant',
    url: `/leitendenbereich/aktionen/aktion?id=${EVENT}`,
    opener: async (page: Page): Promise<RegExp> => {
      const detail = (await (
        await page.request.get(`/api/intern/aktionen/${EVENT}`)
      ).json()) as CampflowEventDetail;
      return new RegExp(formatName(detail.persons[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    },
  },
  {
    name: 'a Nikolaus booking',
    url: '/leitendenbereich/nikolaus?ansicht=liste',
    opener: (): Promise<RegExp> => Promise.resolve(/Familie Huber/),
  },
];

for (const entry of DETAIL_DIALOGS) {
  test(`the details of ${entry.name} close on the backdrop, not after selecting text, and return the focus`, async ({
    page,
  }) => {
    await page.goto(entry.url);
    const { opener, dialog } = await openDetails(page, await entry.opener(page));
    // The dialog is named by its own heading, so screen readers announce whose details these are.
    const heading = dialog.getByRole('heading', { level: 2 });
    await expect(dialog).toHaveAccessibleName((await heading.textContent())?.trim() ?? '');

    // Selecting text that ends outside the dialog keeps it open.
    await selectOutward(page, dialog.locator('dl'));
    await expect(dialog).toBeVisible();

    await clickBackdrop(page);
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.getByRole('button', { name: 'Details schließen', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
  });
}

test('the Fahrten person dialog closes on the backdrop, not after selecting text, and returns the focus', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aktionen/fahrten?id=evt_HikeMangfall');
  const passenger = page
    .getByRole('region', { name: 'Planung' })
    .locator('ol > li ul button')
    .first();
  const name = (await passenger.locator('span').nth(1).textContent())?.trim() ?? '';
  await passenger.click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();

  await selectOutward(page, dialog.getByText(/^(Hinfahrt|Rückfahrt) ·/));
  await expect(dialog).toBeVisible();

  await clickBackdrop(page);
  await expect(dialog).not.toBeVisible();
  await expect(passenger).toBeFocused();

  await passenger.click();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(passenger).toBeFocused();
});
