import { test, expect } from './fixtures';

test('the maps load their tiles from our own site and follow the dark theme', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const { hostname } = new URL(request.url());
    if (request.resourceType() === 'image' && !['127.0.0.1', 'localhost'].includes(hostname))
      foreign.push(hostname);
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/leitendenbereich/nikolaus-dispo');
  const map = page.locator('.dispo-map.leaflet-container');
  await expect(map).toBeVisible();
  await expect(map.locator('img.leaflet-tile').first()).toHaveAttribute(
    'src',
    /^\/api\/karte\/hell\/\d+\/\d+\/\d+\.png$/
  );
  // The copyright notice Azure Maps requires, next to our own
  const attribution = map.locator('.leaflet-control-attribution');
  await expect(attribution).toContainText('© Microsoft');
  await expect(attribution).toContainText('TomTom');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(map.locator('img.leaflet-tile').first()).toHaveAttribute(
    'src',
    /^\/api\/karte\/dunkel\//
  );
  expect(foreign).toEqual([]);
});

test('a failed copyright notice is asked again without zooming', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/karte-quelle/**', async (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 200, json: { copyrights: [] } });
    return route.fallback();
  });
  await page.goto('/leitendenbereich/nikolaus-dispo');
  const attribution = page.locator('.dispo-map .leaflet-control-attribution');
  await expect(attribution).toContainText('© Microsoft');
  await expect(attribution).toContainText('TomTom', { timeout: 15_000 });
  expect(calls).toBe(2);
});

test('a late notice of another zoom level does not replace the shown one', async ({ page }) => {
  let releaseLate: (() => void) | undefined;
  // No level is held back until the test zooms out
  let lateZoom = -1;
  const asked: number[] = [];
  await page.route('**/api/karte-quelle/**', async (route) => {
    const zoom = Number(new URL(route.request().url()).pathname.split('/').pop());
    asked.push(zoom);
    const copyrights = [`Stufe ${zoom}`];
    if (zoom === lateZoom) await new Promise<void>((resolve) => (releaseLate = resolve));
    return route.fulfill({ status: 200, json: { copyrights } });
  });
  await page.goto('/leitendenbereich/nikolaus-dispo');
  const map = page.locator('.dispo-map');
  const attribution = map.locator('.leaflet-control-attribution');
  await expect(attribution).toContainText('Stufe');
  const shownZoom = asked[asked.length - 1];
  await expect(attribution).toContainText(`Stufe ${shownZoom}`);

  // Zoom out, and back in before the answer for the other level arrives
  lateZoom = shownZoom - 1;
  await map.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => releaseLate !== undefined).toBe(true);
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(500);
  releaseLate?.();
  await page.waitForTimeout(500);
  await expect(attribution).toContainText(`Stufe ${shownZoom}`);
  await expect(attribution).not.toContainText(`Stufe ${lateZoom}`);
});
