import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the map view shows the visits and drives and leads to the list', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo');
  await page.getByRole('button', { name: 'Karte', exact: true }).click();
  await expect(page).toHaveURL(/ansicht=karte/);
  const map = page.locator('.dispo-map-main.leaflet-container');
  await expect(map).toBeVisible();
  await expect(page.locator('.stop-card').first()).toBeHidden();

  // Pointing at a visit shows its details
  const marker = map.locator('.leaflet-marker-icon').first();
  await marker.hover();
  await expect(page.locator('.leaflet-tooltip .dispo-tip-title').first()).toContainText('Familie');
  await page.screenshot({ path: test.info().outputPath('karte.png') });

  // Choosing a visit in the panel, then going to it in the list
  const item = page.locator('.stop-item').first();
  const family = (await item.locator('.truncate').textContent())!.trim();
  await item.click();
  const card = page.locator('.selected-card');
  await expect(card).toContainText(family);
  await card.getByRole('button', { name: 'In der Liste zeigen' }).click();
  await expect(page).not.toHaveURL(/ansicht=karte/);
  await expect(page.locator('.stop-card').filter({ hasText: family })).toBeInViewport();

  // And back to the map from the list
  await page
    .locator('.stop-card')
    .filter({ hasText: family })
    .getByRole('button', { name: 'Auf der Karte zeigen' })
    .click();
  await expect(page.locator('.selected-card')).toContainText(family);
  await expectNoHorizontalOverflow(page);
});

test('choosing a visit on the map keeps its details open, and printing shows the list', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  const map = page.locator('.dispo-map-main.leaflet-container');
  const marker = map.locator('.leaflet-marker-icon').last();
  await marker.click();
  await expect(page.locator('.selected-card')).toBeVisible();
  // The marker is not drawn anew, so its details stay open
  await expect(map.locator('.leaflet-tooltip .dispo-tip-title')).toBeVisible();
  await expect(marker.locator('.dispo-marker')).toHaveClass(/is-selected/);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.map-view')).toBeHidden();
  await expect(page.locator('.stop-card').first()).toBeVisible();
});

test('choosing a visit in the panel keeps the map in view', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  await page.locator('.stop-item').last().click();
  await expect(page.locator('.selected-card')).toBeVisible();
  await expect(page.locator('.dispo-map-main')).toBeInViewport({ ratio: 0.5 });
});

test('teams can be hidden on the map', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  const map = page.locator('.dispo-map-main.leaflet-container');
  await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
  const all = await map.locator('.leaflet-marker-icon').count();
  const chip = page.locator('.team-chip').first();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => map.locator('.leaflet-marker-icon').count()).toBeLessThan(all);
  await page.getByRole('button', { name: 'Alle Teams zeigen' }).click();
  await expect.poll(() => map.locator('.leaflet-marker-icon').count()).toBe(all);
});
