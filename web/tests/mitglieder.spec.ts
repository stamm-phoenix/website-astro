import { readFile } from 'node:fs/promises';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { Page } from '@playwright/test';

/** Picks a group: a list on phones, tabs on wider screens. */
async function gruppe(page: Page, name: RegExp): Promise<void> {
  const list = page.getByRole('combobox', { name: 'Gruppe' });
  if (await list.isVisible()) {
    const label = await list.getByRole('option', { name }).textContent();
    await list.selectOption({ label: label ?? '' });
  } else {
    await page
      .getByRole('group', { name: 'Nach Gruppe filtern' })
      .getByRole('button', { name })
      .click();
  }
}

test('Leitende see the members by group and look up one of them, read-only', async ({ page }) => {
  await page.goto('/leitendenbereich/mitglieder');
  const liste = page.getByRole('list', { name: 'Mitglieder' });

  // „Alle“ shows the current members; the former one waits under „Ausgetreten“
  await expect(liste.getByRole('listitem')).toHaveCount(20);
  await expect(liste.getByText('Otto Ehemalig')).toHaveCount(0);
  await expect(liste.getByRole('button', { name: /Nina Neu/ })).toContainText(/Tritt am .* ein/);
  await expectNoHorizontalOverflow(page);

  // The count of a group with a space in its name reaches screen readers (desktop tabs)
  const tabs = page.getByRole('group', { name: 'Nach Gruppe filtern' });
  if (await tabs.isVisible()) {
    await expect(tabs.getByRole('button', { name: /Wölfling/ })).toHaveAccessibleDescription(
      '7 Mitglieder'
    );
  }

  await gruppe(page, /Wölfling/);
  await expect(page).toHaveURL(/\?gruppe=/);
  await expect(liste.getByRole('listitem')).toHaveCount(7);
  await gruppe(page, /Ausgetreten/);
  await expect(liste.getByRole('listitem')).toHaveCount(1);
  await expect(liste).toContainText('Otto Ehemalig');
  await expect(liste).toContainText('Ausgetreten am');

  // The tab survives a reload
  await page.reload();
  await expect(liste.getByRole('listitem')).toHaveCount(1);
  await expect(liste).toContainText('Otto Ehemalig');

  await gruppe(page, /^Alle/);
  await page.getByRole('searchbox', { name: 'Suche' }).fill('vera');
  await expect(liste.getByRole('listitem')).toHaveCount(1);
  await liste.getByRole('button', { name: /Vera Vorstand/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Vera Vorstand' });
  await expect(dialog).toContainText('Mitglied seit');
  await expect(dialog).toContainText('Konfession');
  await expect(dialog).toContainText(/40,00\s€/);
  await expect(dialog.getByRole('link', { name: /^0176/ })).toHaveAttribute('href', /^tel:/);
  await expect(dialog).not.toContainText('IBAN');
  await expect(dialog).not.toContainText('Gesundheit');
  await expect(dialog).not.toContainText('per_MockVera');
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Details schließen' }).click();
  await expect(dialog).toBeHidden();

  // „Neu aus CampFlow laden“ asks CampFlow again and says so
  const refresh = page.waitForRequest((r) => r.url().includes('/intern/mitglieder?refresh=true'));
  await page.getByRole('button', { name: 'Neu aus CampFlow laden' }).click();
  await refresh;
  await expect(page.getByText('Mitgliederliste neu aus CampFlow geladen.')).toBeVisible();

  // Nothing on the page changes CampFlow
  await expect(page.locator('main form, main [contenteditable]')).toHaveCount(0);
});

test('the own member entry is marked', async ({ page }) => {
  await page.goto('/leitendenbereich/mitglieder');
  await expect(
    page.getByRole('list', { name: 'Mitglieder' }).getByRole('button', { name: /Demo Leitung/ })
  ).toContainText('(ich)');
});

test('fields whose names could not be loaded are left out instead of showing their keys', async ({
  page,
}) => {
  await page.route('**/api/intern/mitglieder', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { columns: unknown[] };
    await route.fulfill({ response, json: { ...body, columns: [] } });
  });
  await page.goto('/leitendenbereich/mitglieder');
  await page.getByRole('searchbox', { name: 'Suche' }).fill('vera');
  await page
    .getByRole('list', { name: 'Mitglieder' })
    .getByRole('button', { name: /Vera Vorstand/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Vera Vorstand' });
  await expect(dialog).toContainText('Telefon');
  await expect(dialog).not.toContainText('col_');
});

test('the members of the chosen group download as a PDF', async ({ page }) => {
  await page.goto('/leitendenbereich/mitglieder');
  // The group filter is a list on phones and buttons on wide screens, both shown once loaded
  await expect(
    page.getByRole('list', { name: 'Mitglieder' }).getByRole('listitem').first()
  ).toBeVisible();
  await gruppe(page, /Wölfling/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen', exact: true }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/^Mitglieder Woelfling \d{4}-\d{2}-\d{2}\.pdf$/);
  const content = await readFile(await pdf.path());
  expect(content.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByText('PDF heruntergeladen.')).toBeVisible();
});
