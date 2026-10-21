import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the map view shows the visits and drives and leads to the list', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo');
  await page.getByRole('button', { name: 'Karte', exact: true }).click();
  await expect(page).toHaveURL(/ansicht=karte/);
  const map = page.locator('.dispo-map-main.leaflet-container');
  await expect(map).toBeVisible();
  await expect(page.locator('.stop-card').first()).toBeHidden();

  // Pointing at a visit shows its details
  // A marker away from the others, so no neighbour's tap area covers it
  const marker = map.locator('.leaflet-marker-icon').last();
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
  // The keyboard stays at the same visit
  await expect(page.locator('.stop-item[aria-current="true"]')).toBeFocused();
  // Switching to the list and back does not choose that visit again
  await page.locator('.selected-card').getByRole('button', { name: 'Schließen' }).click();
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await page.getByRole('button', { name: 'Karte', exact: true }).click();
  await expect(page.locator('.dispo-map-main .leaflet-marker-icon').first()).toBeVisible();
  await expect(page.locator('.selected-card')).toHaveCount(0);
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

test('pointing at a drive highlights both visits and the team shows its kilometres', async ({
  page,
  isMobile,
}) => {
  // The courses along the roads arrive after the map is drawn and move the lines
  const courses = page.waitForResponse((response) =>
    response.url().includes('/api/intern/nikolaus/dispo/routes')
  );
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  await courses;
  const map = page.locator('.dispo-map-main.leaflet-container');
  await expect(map.locator('.leaflet-marker-icon').nth(1)).toBeVisible();
  await expect(
    page
      .locator('.map-panel')
      .getByText(/Strecke (ca\.|mind\.) [\d,]+ km/)
      .first()
  ).toBeVisible();
  await map.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  // Between the second and third visit of the first team, far enough apart on a phone
  const [first, second] = await map.locator('.leaflet-marker-icon').evaluateAll((elements) =>
    elements.slice(1, 3).map((element) => {
      const box = element.getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })
  );
  const middle = { x: (first[0] + second[0]) / 2, y: (first[1] + second[1]) / 2 };
  // On a phone the drive is tapped
  if (isMobile) await page.touchscreen.tap(middle.x, middle.y);
  else await page.mouse.move(middle.x, middle.y);
  await expect(map.locator('.leaflet-tooltip').filter({ hasText: 'Fahrt' })).toContainText(' km');
  await expect(map.locator('.dispo-marker.is-leg-end')).toHaveCount(2);
  await expect(page.locator('.stop-item.is-leg-end')).toHaveCount(2);

  const box = (await map.boundingBox())!;
  if (isMobile) await page.touchscreen.tap(box.x + box.width - 10, box.y + box.height / 2);
  else await page.mouse.move(5, 5);
  await expect(map.locator('.dispo-marker.is-leg-end')).toHaveCount(0);
  await expect(page.locator('.stop-item.is-leg-end')).toHaveCount(0);
});

test('the Großansicht keeps the keyboard on the map and gives it back', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  const open = page.getByRole('button', { name: 'Großansicht', exact: true });
  await open.click();
  const close = page.getByRole('button', { name: 'Großansicht beenden' });
  await expect(close).toBeFocused();
  // The covered page cannot be reached
  expect(
    await page
      .getByRole('button', { name: 'Speichern' })
      .evaluate((element) => element.closest('[inert]') !== null)
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  expect(
    await page
      .getByRole('button', { name: 'Speichern' })
      .evaluate((element) => element.closest('[inert]') !== null)
  ).toBe(false);
});

test('the large map switches between light and dark tiles on its own', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  const map = page.locator('.dispo-map-main.leaflet-container');
  const tile = map.locator('img.leaflet-tile').first();
  await expect(tile).toHaveAttribute('src', /^\/api\/karte\/hell\//);
  const light = page.getByRole('button', { name: 'Helle Karte' });
  const dark = page.getByRole('button', { name: 'Dunkle Karte' });
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(tile).toHaveAttribute('src', /^\/api\/karte\/dunkel\//);
  // The choice stays when the list was shown in between
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await page.getByRole('button', { name: 'Karte', exact: true }).click();
  await expect(map.locator('img.leaflet-tile').first()).toHaveAttribute(
    'src',
    /^\/api\/karte\/dunkel\//
  );
  await expectNoHorizontalOverflow(page);
});

test('road courses that arrive late are fitted into the map', async ({ page }) => {
  // The course of a team takes a detour far north of all visits
  let release: (() => void) | undefined;
  await page.route('**/api/intern/nikolaus/dispo/routes**', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { paths: Record<string, [number, number][] | null> };
    // Team B: all its visits are on the map, so the map follows its course
    const team = 'B';
    const path = body.paths[team];
    const [lat, lon] = path![1];
    body.paths[team] = [path![0], [lat + 0.3, lon], ...path!.slice(1)];
    await new Promise<void>((resolve) => (release = resolve));
    await route.fulfill({ response, json: body });
  });
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  const map = page.locator('.dispo-map-main.leaflet-container');
  const zoom = async (): Promise<number> =>
    Number(
      /\/(\d+)\/\d+\/\d+\.png$/.exec(
        (await map.locator('img.leaflet-tile').last().getAttribute('src')) ?? ''
      )?.[1]
    );
  await expect(map.locator('img.leaflet-tile').first()).toBeVisible();
  await expect.poll(() => release !== undefined).toBe(true);
  const before = await zoom();
  release!();
  // The map zooms out to show the detour
  await expect.poll(zoom).toBeLessThan(before);
});

test('showing a route from the panel brings the map back into view', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  await expect(page.locator('.dispo-map-main .leaflet-marker-icon').first()).toBeVisible();
  const button = page.getByRole('button', { name: 'Route zeigen' }).last();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.locator('.dispo-map-main')).toBeInViewport({ ratio: 0.5 });
});

test('a visit already checked off keeps its team on the map', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  await page.locator('.stop-item').filter({ hasText: 'besucht' }).first().click();
  const card = page.locator('.selected-card');
  await expect(card).toContainText('Besucht');
  await expect(card.getByRole('combobox')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /^Team festhalten/ })).toHaveCount(0);
  await page.locator('.stop-item').filter({ hasNotText: 'besucht' }).first().click();
  await expect(card.getByRole('combobox')).toBeVisible();
});

test('teams can be hidden on the map', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-dispo?ansicht=karte');
  const map = page.locator('.dispo-map-main.leaflet-container');
  await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
  const all = await map.locator('.leaflet-marker-icon').count();
  const chip = page.locator('.team-chip').first();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(chip).toContainText('ausgeblendet');
  await expect.poll(() => map.locator('.leaflet-marker-icon').count()).toBeLessThan(all);
  await page.getByRole('button', { name: 'Alle Teams zeigen' }).click();
  await expect.poll(() => map.locator('.leaflet-marker-icon').count()).toBe(all);
});
