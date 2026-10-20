import { randomUUID } from 'node:crypto';
import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import type { Page } from '@playwright/test';
import type { StaffNikolausFahrtData } from '../src/lib/types';

const URL = '/leitendenbereich/nikolaus-fahrt?tag=2026-12-05&team=A';
const KEY = 'nikolaus-fahrt-offline-v1';
const GET = '/api/intern/nikolaus/fahrt?date=2026-12-05';
const POST = '/api/intern/pflege/nikolaus-fahrt?date=2026-12-05';

async function prepare(page: Page): Promise<void> {
  // The service worker has its own real clock. Keep expiry comparable across both contexts.
  await page.clock.setFixedTime(new Date());
  const data = (await (await page.request.get(GET)).json()) as StaffNikolausFahrtData;
  for (const stop of data.routes.A) {
    const response = await page.request.post(POST, {
      data: {
        bookingId: stop.bookingId,
        visited: false,
        version: stop.visitVersion,
        operationId: randomUUID(),
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto(URL);
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Route für Funklöcher speichern' }).click();
  await expect(page.getByText(/Auf diesem Gerät gespeichert bis/)).toBeVisible({
    timeout: 20_000,
  });
}

function visitButton(page: Page) {
  return page
    .getByRole('article', { name: /Als Nächstes/ })
    .getByRole('button', { name: /Besucht/ });
}

async function queueLength(page: Page): Promise<number> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{"queue":[]}').queue.length,
    KEY
  );
}

test('selected route stays readable offline; pending visit replays on reconnection', async ({
  page,
  context,
}) => {
  await prepare(page);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(Object.keys(stored.data.routes)).toEqual(['A']);
  expect(stored.data.teams.map((team: { name: string }) => team.name)).toEqual(['A']);
  await context.setOffline(true);
  await visitButton(page).click();
  await expect(page.getByText('Besucht – noch nicht bestätigt', { exact: true })).toBeVisible();
  await expect(page.getByText(/wartet auf Verbindung/)).toBeVisible();
  await expect.poll(() => queueLength(page)).toBe(1);
  await expectNoHorizontalOverflow(page);
  await context.setOffline(false);
  await page.bringToFront();
  await expect.poll(() => queueLength(page), { timeout: 15_000 }).toBe(0);
  await expect(page.getByText('Besucht – noch nicht bestätigt', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('an offline reload restores the next stop and queued visits, which can then be confirmed', async ({
  page,
  context,
}) => {
  await prepare(page);
  await context.setOffline(true);
  await visitButton(page).click();
  await expect.poll(() => queueLength(page)).toBe(1);
  await page.reload();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  await expect(page.getByText('Besucht – noch nicht bestätigt', { exact: true })).toBeVisible();
  await expect.poll(() => queueLength(page)).toBe(1);
  // Keep automatic reconnect attempts pending locally until the manual retry.
  let allowConfirmation = false;
  await page.route('**/api/intern/pflege/nikolaus-fahrt?*', (route) =>
    allowConfirmation ? route.continue() : route.abort('failed')
  );
  await context.setOffline(false);
  const retry = page.getByRole('button', { name: 'Jetzt abgleichen' });
  await expect(retry).toBeEnabled({ timeout: 20_000 });
  allowConfirmation = true;
  await retry.click();
  await expect.poll(() => queueLength(page), { timeout: 15_000 }).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test('lost response retries same operation ID without duplicate effects', async ({ page }) => {
  await prepare(page);
  const bodies: { operationId: string }[] = [];
  let loseResponse = true;
  await page.route('**/api/intern/pflege/nikolaus-fahrt?*', async (route) => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (loseResponse) {
      loseResponse = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await visitButton(page).click();
  await expect(page.getByText(/wartet auf Verbindung/)).toBeVisible();
  await expect.poll(() => queueLength(page)).toBe(1);
  await expect(page.getByRole('button', { name: /Rückgängig/ }).first()).toBeDisabled();
  await expect.poll(() => loseResponse).toBe(false);
  const before = (await (await page.request.get(GET)).json()) as StaffNikolausFahrtData;
  await page.getByRole('button', { name: 'Jetzt abgleichen' }).click();
  await expect.poll(() => queueLength(page)).toBe(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[0].operationId).toBe(bodies[1].operationId);
  const after = (await (await page.request.get(GET)).json()) as StaffNikolausFahrtData;
  expect(after.routes.A).toEqual(before.routes.A);
});

test('conflict remains visible until discarded without overwriting server', async ({
  page,
  context,
}) => {
  await prepare(page);
  const data = (await (await page.request.get(GET)).json()) as StaffNikolausFahrtData;
  const stop = data.routes.A[0];
  await context.setOffline(true);
  await visitButton(page).click();
  await expect.poll(() => queueLength(page)).toBe(1);
  await page.request.post(POST, {
    data: {
      bookingId: stop.bookingId,
      visited: true,
      version: stop.visitVersion,
      operationId: randomUUID(),
    },
  });
  await context.setOffline(false);
  await expect(page.getByText(/Konflikt: Besuch oder Planung inzwischen geändert/)).toBeVisible();
  await expect.poll(() => queueLength(page)).toBe(1);
  await page.getByRole('button', { name: 'Markierung verwerfen', exact: true }).click();
  await answerConfirm(page, 'Markierung verwerfen?', 'Verwerfen');
  await expect.poll(() => queueLength(page)).toBe(0);
  const saved = (await (await page.request.get(GET)).json()) as StaffNikolausFahrtData;
  expect(saved.routes.A.find((entry) => entry.bookingId === stop.bookingId)?.visited).toBe(true);
});

test('local route restores when API fails and expires without retention extension', async ({
  page,
}) => {
  await prepare(page);
  const expiresAt = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).expiresAt,
    KEY
  );
  await page.route('**/api/intern/nikolaus/fahrt?*', (route) => route.abort());
  await page.reload();
  await expect(page.getByText(/Gerade keine Verbindung/)).toBeVisible();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).expiresAt, KEY)).toBe(
    expiresAt
  );
  await page.evaluate((key) => {
    const snapshot = JSON.parse(localStorage.getItem(key)!);
    snapshot.expiresAt = Date.now() - 1;
    localStorage.setItem(key, JSON.stringify(snapshot));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, KEY);
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});

test('explicit deletion and logout remove locally saved family data', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Route von diesem Gerät löschen' }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Route für Funklöcher speichern' }).click();
  await expect(page.getByText(/Auf diesem Gerät gespeichert bis/)).toBeVisible({
    timeout: 20_000,
  });
  await page.goto('/leitendenbereich');
  // The logout is in the header, and on a phone in the sheet „Alle Bereiche“
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  await page
    .getByRole('link', { name: 'Abmelden', exact: true })
    .or(page.getByRole('button', { name: 'Menü', exact: true }))
    .filter({ visible: true })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
  if (await sheet.isVisible()) {
    await sheet.getByRole('link', { name: 'Abmelden', exact: true }).click();
  }
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});

test('denied authentication removes the cached route and outbox', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/intern/nikolaus/fahrt?*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Anmeldung ungültig.' }),
    })
  );
  await page.reload();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Die Daten konnten nicht geladen werden.' })
  ).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toHaveCount(0);
});

test('storage failure is visible and never sends an unpersisted offline mutation', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    };
  });
  let writes = 0;
  await page.route('**/api/intern/pflege/nikolaus-fahrt?*', async (route) => {
    writes++;
    await route.continue();
  });
  await visitButton(page).click();
  await expect(
    page.getByText(/Die Änderung konnte nicht auf diesem Gerät gespeichert werden/)
  ).toBeVisible();
  expect(writes).toBe(0);
  expect(await queueLength(page)).toBe(0);
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
});

test('deleting a saved route preserves server data after a failed refresh', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/intern/nikolaus/fahrt?*', (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/Gerade keine Verbindung/)).toBeVisible();
  await page.getByRole('button', { name: 'Route von diesem Gerät löschen' }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
});

test('deleting a restored snapshot clears the displayed family data', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/intern/nikolaus/fahrt?*', (route) => route.abort());
  await page.reload();
  await expect(page.getByText(/Gerade keine Verbindung/)).toBeVisible();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Route von diesem Gerät löschen' }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toHaveCount(0);
});

test('expiry during preparation preserves the new deployment HTML and its dependencies', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date());
  await page.goto(URL);
  const save = page.getByRole('button', { name: 'Route für Funklöcher speichern' });
  await expect(save).toBeVisible();
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="/_astro/new-release.css">
    <script type="module" src="/_astro/new-release-entry.js"></script>
    </head><body>
    <astro-island component-url="/_astro/new-release-component.js" renderer-url="/_astro/new-release-renderer.js"></astro-island>
    <script type="module">import('/_astro/new-release-inline.js')</script>
    </body></html>`;
  await page.route('**/leitendenbereich/nikolaus-fahrt', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  );
  await page.evaluate(() => {
    const state = window as unknown as { releaseAsset: () => void; assetRequested: boolean };
    const pending = new Promise<void>((resolve) => {
      state.releaseAsset = resolve;
    });
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const path = new window.URL(String(input), location.href).pathname;
      if (!path.startsWith('/_astro/new-release')) return original(input, init);
      if (path.endsWith('entry.js')) {
        state.assetRequested = true;
        await pending;
      }
      return new Response(
        path.endsWith('entry.js')
          ? "import './new-release-dependency.js';"
          : path.endsWith('.css')
            ? "@font-face { font-family: demo; src: url('./new-release-font.woff2'); }"
            : '',
        { headers: { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } }
      );
    };
  });
  await save.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { assetRequested: boolean }).assetRequested)
    )
    .toBe(true);
  await page.evaluate(async () => {
    const path = '/src/lib/nikolausFahrtStore.svelte.ts';
    const store = await import(path);
    void store.expireNikolausRoute();
  });
  await page.evaluate(() => (window as unknown as { releaseAsset: () => void }).releaseAsset());
  await expect(page.getByText(/Auf diesem Gerät gespeichert bis/)).toBeVisible({
    timeout: 20_000,
  });
  const cached = await page.evaluate(async () => {
    const path = '/src/lib/nikolausFahrtStore.svelte.ts';
    await (await import(path)).expireNikolausRoute();
    const cache = await caches.open('nikolaus-route-shell-v1');
    return {
      html: await (await cache.match('/leitendenbereich/nikolaus-fahrt'))?.text(),
      paths: (await cache.keys()).map((request) => new window.URL(request.url).pathname),
      snapshot: !!localStorage.getItem('nikolaus-fahrt-offline-v1'),
    };
  });
  expect(cached.snapshot).toBe(true);
  expect(cached.html).toBe(html);
  for (const asset of [
    'entry.js',
    'dependency.js',
    'component.js',
    'renderer.js',
    'inline.js',
    'font.woff2',
  ])
    expect(cached.paths).toContain(`/_astro/new-release-${asset}`);
  expect(cached.paths).toContain('/_astro/new-release.css');
});

test('a saved day added after the baked settings still restores offline', async ({
  page,
  context,
}) => {
  await prepare(page);
  await page.evaluate((key) => {
    const snapshot = JSON.parse(localStorage.getItem(key)!);
    snapshot.data.date = '2026-12-07';
    localStorage.setItem(key, JSON.stringify(snapshot));
    history.replaceState(
      history.state,
      '',
      '/leitendenbereich/nikolaus-fahrt?tag=2026-12-07&team=A'
    );
  }, KEY);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  await expect(page.getByText(/Auf diesem Gerät gespeichert bis/)).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Tag wählen' }).getByRole('button', { name: /7\.12\./ })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/tag=2026-12-07/);
});
