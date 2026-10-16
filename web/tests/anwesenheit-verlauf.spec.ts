import { test, expect } from './fixtures';
import type { AnwesenheitOverview } from '../src/lib/types';

test('the attendance history shows names and opens the chosen date', async ({ page }) => {
  const overview = (await (
    await page.request.get('/api/intern/anwesenheit')
  ).json()) as AnwesenheitOverview;
  const meeting = overview.meetings.find((m) => m.stufe === 'Wölflinge')!;
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByRole('button', { name: 'Verlauf & Statistik', exact: true }).click();
  const row = page.locator(`[data-meeting-date="${meeting.date}"]`);
  await row.getByRole('button', { name: /Namen ansehen/ }).click();
  await expect(row.getByText('Anna Test', { exact: true })).toBeVisible();
  await expect(row.getByText('Ben Beispiel', { exact: true })).toBeVisible();
  await expect(row.getByText('Clara Muster', { exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Termin öffnen', exact: true }).click();
  await expect(page.getByLabel('Datum', { exact: true })).toHaveValue(meeting.date);
  await expect(page.getByRole('button', { name: 'Anna Test', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('history retries a name lookup and explains anonymized attendance', async ({ page }) => {
  const date = '2020-01-10';
  const data = (await (
    await page.request.get('/api/intern/anwesenheit')
  ).json()) as AnwesenheitOverview;
  data.meetings = [{ stufe: 'Wölflinge', date, members: 2, guests: 1, notes: '' }];
  await page.route('**/api/intern/anwesenheit', (route) => route.fulfill({ json: data }));
  let tries = 0;
  await page.route(`**/api/intern/anwesenheit/woelflinge/${date}`, (route) => {
    tries++;
    return route.fulfill(
      tries === 1
        ? { status: 500, json: {} }
        : {
            json: {
              stufe: 'Wölflinge',
              date,
              editable: false,
              etag: null,
              notes: '',
              children: [],
              guests: [],
              anonymized: 2,
              anonymizedGuests: 1,
            },
          }
    );
  });
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByRole('button', { name: 'Verlauf & Statistik', exact: true }).click();
  const row = page.locator(`[data-meeting-date="${date}"]`);
  await row.getByRole('button', { name: /Namen ansehen/ }).click();
  await expect(
    row.getByText('Die Namen konnten nicht geladen werden.', { exact: false })
  ).toBeVisible();
  await row.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(row.getByText(/Namen.*Aufbewahrungsfrist/)).toBeVisible();
  expect(tries).toBe(2);
});
