import { test, expect } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await page.request.post('/api/__mock/aufgaben/reset');
  await page.route('**/api/intern/neuigkeiten', (route) =>
    route.fulfill({ json: { lastSeenId: null } })
  );
  await page.route('**/api/intern/zuletzt', (route) => route.fulfill({ json: { modules: [] } }));
});

test('general areas remain usable while APIs wait and no personal areas are known', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.fallback();
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 50,
    downloadThroughput: 1_000_000,
    uploadThroughput: 100_000,
  });
  await page.request.get('/leitendenbereich');
  await page.goto('/leitendenbereich', { waitUntil: 'commit' });
  const all = page.getByRole('region', { name: 'Alle Bereiche', exact: true });
  await expect(all.getByRole('link', { name: /^Aufgaben/ })).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole('region', { name: 'Deine Bereiche' })).toHaveCount(0);
});

test('empty favorites and recent areas do not create a personal section', async ({ page }) => {
  await page.route('**/api/intern/favoriten', (route) => route.fulfill({ json: { modules: [] } }));
  await page.goto('/leitendenbereich');
  await expect(
    page.getByRole('button', { name: 'Aufgaben als Favorit', exact: true }).first()
  ).toBeAttached();
  await expect(page.getByRole('region', { name: 'Deine Bereiche' })).toHaveCount(0);
  await expect(page.getByText('Noch keine Favoriten.')).toHaveCount(0);
});

test('personal areas show only actual favorites and recently used modules', async ({ page }) => {
  await page.route('**/api/intern/favoriten', (route) =>
    route.fulfill({ json: { modules: ['/leitendenbereich/belege'] } })
  );
  await page.route('**/api/intern/zuletzt', (route) =>
    route.fulfill({ json: { modules: ['/leitendenbereich/aufgaben'] } })
  );
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  await expect(areas.getByRole('link')).toHaveText(['Belege', 'Aufgaben']);
});

test('news is visible above the dashboard on a phone', async ({ page }) => {
  await page.route('**/api/intern/neuigkeiten', (route) =>
    route.fulfill({ json: { lastSeenId: null } })
  );
  await page.goto('/leitendenbereich');
  const news = page.getByRole('link', { name: 'Neuigkeiten lesen', exact: true });
  await expect(news).toBeInViewport();
  await page.screenshot({ path: '/tmp/429-news-personal.png' });
  const dashboard = page.getByRole('heading', { name: 'Für dich', exact: true });
  expect((await news.boundingBox())!.y).toBeLessThan((await dashboard.boundingBox())!.y);
});

test('a failed favorites request offers retry without invented personal areas', async ({
  page,
}) => {
  let failed = true;
  await page.route('**/api/intern/favoriten', (route) =>
    failed
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: { modules: ['/leitendenbereich/belege'] } })
  );
  await page.goto('/leitendenbereich');
  await expect(page.getByText(/Deine Favoriten konnten nicht geladen werden/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Deine Bereiche' })).toHaveCount(0);
  failed = false;
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Erneut versuchen', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Deine Bereiche' }).getByRole('link')).toHaveText([
    'Belege',
  ]);
});

test('removing the last favorite releases the tile and hides the personal section', async ({
  page,
}) => {
  await page.request.put('/api/intern/favoriten', {
    data: { modules: ['/leitendenbereich/mitglieder'] },
  });
  await page.goto('/leitendenbereich');
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const remove = areas.getByRole('button', { name: 'Mitglieder aus deinen Favoriten entfernen' });
  await expect(remove).toBeVisible();
  await areas.getByRole('link', { name: 'Mitglieder', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(areas).toHaveCount(0);
});

test('a delayed selection preserves a focused recent area despite mouse movement elsewhere', async ({
  page,
}) => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/zuletzt', (route) =>
    route.fulfill({ json: { modules: ['/leitendenbereich/aufgaben', '/leitendenbereich/belege'] } })
  );
  await page.route('**/api/intern/favoriten', async (route) => {
    await held;
    await route.fulfill({ json: { modules: ['/leitendenbereich/mitglieder'] } });
  });
  await page.goto('/leitendenbereich');
  await expect(page.getByRole('link', { name: 'Neuigkeiten lesen', exact: true })).toBeVisible();
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const tasks = areas.getByRole('link', { name: 'Aufgaben', exact: true });
  await tasks.focus();
  const before = await tasks.boundingBox();
  await areas
    .getByRole('link', { name: 'Belege', exact: true })
    .dispatchEvent('pointerleave', { pointerType: 'mouse' });
  release();
  await expect(
    areas.getByRole('button', { name: 'Mitglieder aus deinen Favoriten entfernen' })
  ).toBeVisible();
  await expect(tasks).toBeFocused();
  expect(await tasks.boundingBox()).toEqual(before);
});

test('favorites have one loading announcement', async ({ page }) => {
  await page.route('**/api/intern/favoriten', () => new Promise(() => {}));
  await page.goto('/leitendenbereich');
  await expect(page.getByText('Favoriten werden geladen …', { exact: true })).toHaveCount(1);
});

test('a touched recent area keeps its position until the touch is canceled', async ({ page }) => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/intern/zuletzt', (route) =>
    route.fulfill({ json: { modules: ['/leitendenbereich/aufgaben'] } })
  );
  await page.route('**/api/intern/favoriten', async (route) => {
    await held;
    await route.fulfill({ json: { modules: ['/leitendenbereich/belege'] } });
  });
  await page.goto('/leitendenbereich');
  await expect(page.getByRole('link', { name: 'Neuigkeiten lesen', exact: true })).toBeVisible();
  const areas = page.getByRole('region', { name: 'Deine Bereiche' });
  const tasks = areas.getByRole('link', { name: 'Aufgaben', exact: true });
  await tasks.dispatchEvent('pointerdown', { pointerType: 'touch' });
  const before = await tasks.boundingBox();
  release();
  await expect(
    areas.getByRole('button', { name: 'Belege aus deinen Favoriten entfernen' })
  ).toBeVisible();
  expect(await tasks.boundingBox()).toEqual(before);
  await tasks.dispatchEvent('pointercancel', { pointerType: 'touch' });
  await expect(areas.getByRole('link')).toHaveText(['Belege', 'Aufgaben']);
});
