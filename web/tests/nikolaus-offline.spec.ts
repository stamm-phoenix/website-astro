import { randomUUID } from 'node:crypto';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { Page } from '@playwright/test';
import type { StaffNikolausFahrtData } from '../src/lib/types';

const URL = '/leitendenbereich/nikolaus-fahrt?tag=2026-12-05&team=A';
const KEY = 'nikolaus-fahrt-offline-v1';
const GET = '/api/intern/nikolaus/fahrt?date=2026-12-05';
const POST = '/api/intern/pflege/nikolaus-fahrt?date=2026-12-05';

async function prepare(page: Page): Promise<void> {
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
  await expect(page.getByText(/Diese Teamroute ist auf diesem Gerät/)).toBeVisible();
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
  await expect(page.getByText(/wartet auf Verbindung und Bestätigung/)).toBeVisible();
  await expect.poll(() => queueLength(page)).toBe(1);
  await expectNoHorizontalOverflow(page);
  await context.setOffline(false);
  await expect.poll(() => queueLength(page)).toBe(0);
  await expect(page.getByText('Besucht – noch nicht bestätigt', { exact: true })).toHaveCount(0);
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
  await expect(page.getByText(/wartet auf Verbindung und Bestätigung/)).toBeVisible();
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
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Markierung verwerfen', exact: true }).click();
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
  await page.getByRole('button', { name: 'Lokale Route und Markierungen löschen' }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Route für Funklöcher speichern' }).click();
  await expect(page.getByText(/Diese Teamroute ist auf diesem Gerät/)).toBeVisible();
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: 'Abmelden', exact: true }).click();
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
    page.getByRole('heading', { name: 'Die Route konnte nicht geladen werden' })
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
  await page.getByRole('button', { name: 'Lokale Route und Markierungen löschen' }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
});

test('deleting a restored snapshot clears the displayed family data', async ({ page }) => {
  await prepare(page);
  await page.route('**/api/intern/nikolaus/fahrt?*', (route) => route.abort());
  await page.reload();
  await expect(page.getByText(/Gerade keine Verbindung/)).toBeVisible();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Lokale Route und Markierungen löschen' }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  await expect(page.getByRole('article', { name: /Als Nächstes/ })).toHaveCount(0);
});
