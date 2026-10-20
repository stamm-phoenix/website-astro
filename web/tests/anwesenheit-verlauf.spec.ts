import { test, expect } from './fixtures';
import type { AnwesenheitOverview } from '../src/lib/types';

/** The date of a mock Termin `days` ago, as `dev/mock-data/anwesenheit.ts` creates it. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test('the attendance history shows names and opens the chosen date', async ({ page }) => {
  const overview = (await (
    await page.request.get('/api/intern/anwesenheit')
  ).json()) as AnwesenheitOverview;
  const meeting = overview.meetings.find((m) => m.stufe === 'Wölflinge')!;
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByRole('button', { name: 'Verlauf & Statistik', exact: true }).click();
  const row = page.locator(`[data-meeting-date="${meeting.date}"]`);
  await row.getByRole('button', { name: /Details ansehen/ }).click();
  await expect(row.getByRole('button', { name: /Details ausblenden/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  // Would break if the lists mixed up present and excused children
  await expect(row.getByRole('list', { name: 'Anwesend' }).getByText('Anna Test')).toBeVisible();
  await expect(row.getByRole('list', { name: 'Anwesend' }).getByText('Ben Beispiel')).toBeVisible();
  await expect(
    row.getByRole('list', { name: 'Entschuldigt' }).getByText('David Probe')
  ).toBeVisible();
  await expect(row.getByText('Clara Muster', { exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.getByLabel('Datum', { exact: true })).toHaveValue(meeting.date);
  await expect(
    page
      .getByRole('group', { name: 'Anwesenheit von Anna Test' })
      .getByRole('button', { name: 'Anwesend', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page
      .getByRole('group', { name: 'Anwesenheit von David Probe' })
      .getByRole('button', { name: 'Entschuldigt', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('history shows counts, notes, empty notes and cancelled Gruppenstunden per row', async ({
  page,
}) => {
  // Would break if notes were missing from the list, an empty note showed nothing, or a
  // cancelled Gruppenstunde looked like one with 0 children
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByRole('button', { name: 'Verlauf & Statistik', exact: true }).click();

  const held = page.locator(`[data-meeting-date="${daysAgo(7)}"]`);
  await expect(held).toContainText('Knoten geübt und eine Seilbrücke gebaut.');
  await expect(held).toContainText('2 Kinder · 1 entschuldigt · 0 Gäste');
  await expect(held).not.toContainText('Kein Inhalt erfasst');

  const empty = page.locator(`[data-meeting-date="${daysAgo(14)}"]`);
  await expect(empty).toContainText('Kein Inhalt erfasst');

  const cancelled = page.locator(`[data-meeting-date="${daysAgo(21)}"]`);
  await expect(cancelled).toContainText('Ausgefallen');
  await expect(cancelled).toContainText('Fällt aus wegen der Ferien.');
  await expect(cancelled).not.toContainText('Kinder ·');
  await cancelled.getByRole('button', { name: /Details ansehen/ }).click();
  await expect(cancelled.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  await expect(cancelled.getByRole('list', { name: 'Anwesend' })).toHaveCount(0);

  // Chart and table are there
  await expect(page.getByText('Kinder im Schnitt pro Gruppenstunde')).toBeVisible();
  await page.getByText('Zahlen pro Monat als Tabelle').click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('deleting a Gruppenstunde from the history asks first and removes the row', async ({
  page,
}) => {
  // Would break if the delete ran without a question, or the row stayed after deleting
  const date = daysAgo(200);
  const created = await page.request.put(
    `/api/intern/pflege/anwesenheit/woelflinge/${date}/kinder/per_W1`,
    { data: { status: 'anwesend' } }
  );
  expect(created.ok()).toBe(true);

  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByRole('button', { name: 'Verlauf & Statistik', exact: true }).click();
  const row = page.locator(`[data-meeting-date="${date}"]`);
  await row.getByRole('button', { name: /Details ansehen/ }).click();
  await row.getByRole('button', { name: 'Gruppenstunde löschen', exact: true }).click();

  // Cancelling keeps it
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Gruppenstunde löschen' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Gruppenstunde löschen', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Gruppenstunde löschen', exact: true })
    .click();
  await expect(page.getByText(/^Gruppenstunde am .* gelöscht\.$/).first()).toBeVisible();
  await expect(page.locator(`[data-meeting-date="${date}"]`)).toHaveCount(0);
  const overview = (await (
    await page.request.get('/api/intern/anwesenheit')
  ).json()) as AnwesenheitOverview;
  expect(overview.meetings.some((m) => m.date === date)).toBe(false);
});

test('a Gruppenstunde changed after opening is not deleted, and a deleted one leaves at once', async ({
  page,
}) => {
  // Would break if the delete ignored the loaded version, or if the row came back because
  // loading the Termine again failed after a successful delete
  const date = daysAgo(201);
  const termin = `/api/intern/pflege/anwesenheit/woelflinge/${date}`;
  await page.request.put(`${termin}/kinder/per_W1`, { data: { status: 'anwesend' } });
  const first = await page.request.put(termin, { data: { notes: 'Alt.', etag: null } });
  const { etag } = (await first.json()) as { etag: string };

  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByRole('button', { name: 'Verlauf & Statistik', exact: true }).click();
  const row = page.locator(`[data-meeting-date="${date}"]`);
  await row.getByRole('button', { name: /Details ansehen/ }).click();
  await expect(row.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  // Someone else changes the notes while the details are open
  await page.request.put(termin, { data: { notes: 'Von jemand anderem.', etag } });

  const confirmDelete = async () => {
    await row.getByRole('button', { name: 'Gruppenstunde löschen', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Gruppenstunde löschen', exact: true })
      .click();
  };
  await confirmDelete();
  await expect(
    page.getByText(/inzwischen geändert\. Sie wurde nicht gelöscht\./).first()
  ).toBeVisible();
  await expect(row).toBeVisible();
  // The changed text is shown before anyone can delete it with its new version
  await expect(row.getByText('Von jemand anderem.', { exact: true })).toBeVisible();

  // The details show the new version again; loading the Termine after deleting fails
  await expect(row.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeVisible();
  await page.route('**/api/intern/anwesenheit', (route) =>
    route.fulfill({ status: 500, json: {} })
  );
  await confirmDelete();
  await expect(page.getByText(/^Gruppenstunde am .* gelöscht\.$/).first()).toBeVisible();
  await expect(page.locator(`[data-meeting-date="${date}"]`)).toHaveCount(0);
});

test('history retries a name lookup and explains anonymized attendance', async ({ page }) => {
  const date = '2020-01-10';
  const data = (await (
    await page.request.get('/api/intern/anwesenheit')
  ).json()) as AnwesenheitOverview;
  data.meetings = [
    {
      stufe: 'Wölflinge',
      date,
      members: 2,
      excused: 1,
      guests: 1,
      notes: '',
      cancelled: false,
    },
  ];
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
              cancelled: false,
              children: [],
              guests: [],
              anonymized: 2,
              anonymizedExcused: 1,
              anonymizedGuests: 1,
            },
          }
    );
  });
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByRole('button', { name: 'Verlauf & Statistik', exact: true }).click();
  const row = page.locator(`[data-meeting-date="${date}"]`);
  await row.getByRole('button', { name: /Details ansehen/ }).click();
  await expect(
    row.getByText('Die Namen konnten nicht geladen werden.', { exact: false })
  ).toBeVisible();
  await row.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(row.getByText(/Namen.*Aufbewahrungsfrist/)).toBeVisible();
  await expect(row.getByRole('button', { name: 'Ansehen', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Gruppenstunde löschen' })).toHaveCount(0);
  expect(tries).toBe(2);
});
