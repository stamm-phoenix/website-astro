import { test, expect } from './fixtures';

test('a late cancellation response belongs to its original date after another date was opened', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { today } = (await (await page.request.get('/api/intern/anwesenheit')).json()) as {
    today: string;
  };
  // The demo seeds dates up to 84 days ago. These dates stay empty and editable.
  const [firstDate, nextDate] = [101, 102].map((days) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  });
  const firstWrite = `/api/intern/pflege/anwesenheit/woelflinge/${firstDate}`;
  const nextWrite = `/api/intern/pflege/anwesenheit/woelflinge/${nextDate}`;
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let stored = false;
  await page.route(`**${firstWrite}/ausgefallen`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    stored = true;
    await gate;
    await route.fulfill({ response });
  });
  await page.goto('/leitendenbereich/anwesenheit');
  const date = page.getByLabel('Datum', { exact: true });
  await date.fill(firstDate);
  const notes = page.locator('#anwesenheit-inhalt');
  await expect(notes).toHaveValue('');
  await page
    .getByRole('group', { name: 'Gruppenstunde', exact: true })
    .getByRole('button', { name: 'Ausgefallen', exact: true })
    .click();
  await expect.poll(() => stored).toBe(true);
  const loaded = page.waitForResponse(`**/api/intern/anwesenheit/woelflinge/${nextDate}`);
  await date.fill(nextDate);
  expect((await loaded).ok()).toBe(true);
  await notes.fill('Notiz zum anderen Termin.');
  const save = page.getByRole('button', { name: 'Notiz speichern', exact: true });
  await expect(save).toBeDisabled();
  release();
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === nextWrite && response.request().method() === 'PUT'
  );
  await save.click();
  expect((await saved).ok()).toBe(true);
  const current = await (
    await page.request.get(`/api/intern/anwesenheit/woelflinge/${nextDate}`)
  ).json();
  expect(current.notes).toBe('Notiz zum anderen Termin.');
  expect(current.cancelled).toBe(false);
});
