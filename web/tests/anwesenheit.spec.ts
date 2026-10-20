import type { Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';

/** The three-way choice of one child; each button's aria-pressed marks the current one. */
function choice(page: Page, name: string) {
  const group = page.getByRole('group', { name: `Anwesenheit von ${name}` });
  return {
    group,
    anwesend: group.getByRole('button', { name: 'Anwesend', exact: true }),
    entschuldigt: group.getByRole('button', { name: 'Entschuldigt', exact: true }),
    abwesend: group.getByRole('button', { name: 'Abwesend', exact: true }),
  };
}

test('leaders check in children, add a guest and save what they did', async ({ page }) => {
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: /Anwesenheit/ }).click();
  await expect(page.getByRole('heading', { name: 'Anwesenheit', level: 1 })).toBeVisible();

  // The demo login leads the Wölflinge; the date is their last Gruppenstunde (Fridays)
  await expect(page.getByRole('button', { name: 'Wölflinge' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('heading', { name: /^Wölflinge am Freitag, / })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Choices save on their own, which the page says before and after a tap
  await expect(page.getByText('Jede Auswahl wird sofort gespeichert.')).toBeVisible();
  const anna = choice(page, 'Anna Test');
  await expect(anna.abwesend).toHaveAttribute('aria-pressed', 'true');
  await anna.anwesend.click();
  await expect(anna.anwesend).toHaveAttribute('aria-pressed', 'true');
  const counts = page.getByTestId('anwesenheit-counts');
  await expect(counts).toContainText('1 anwesend, 0 entschuldigt, 3 abwesend');
  await expect(counts).toContainText('Gespeichert');

  await page.getByLabel('Gast hinzufügen').fill('Testgast Schnuppern');
  await page.getByRole('button', { name: 'Eintragen' }).click();
  await expect(
    page.getByText('Testgast Schnuppern ist als Gast eingetragen.').first()
  ).toBeVisible();
  await expect(counts).toContainText('1 anwesend, 0 entschuldigt, 3 abwesend, 1 Gast');

  await page.getByLabel(/Was habt ihr gemacht/).fill('Schnitzeljagd im Wald.');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(page.getByText('Notiz gespeichert.').first()).toBeVisible();

  // Everything was saved, not only shown
  await page.reload();
  await expect(choice(page, 'Anna Test').anwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel(/Was habt ihr gemacht/)).toHaveValue('Schnitzeljagd im Wald.');

  await page.getByRole('button', { name: 'Verlauf & Statistik' }).click();
  await page.getByText('Zahlen pro Monat als Tabelle').click();
  await expect(page.getByRole('table')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Restore the demo state for the following tests of this worker
  await page.getByRole('button', { name: 'Erfassen' }).click();
  await page.getByRole('button', { name: 'Testgast Schnuppern entfernen' }).click();
  await expect(
    page.getByText('Testgast Schnuppern ist nicht mehr eingetragen.').first()
  ).toBeVisible();
  await choice(page, 'Anna Test').abwesend.click();
  await expect(choice(page, 'Anna Test').abwesend).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel(/Was habt ihr gemacht/).fill('');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(page.getByText('Notiz gespeichert.').first()).toBeVisible();
});

test('a choice that fails to save names the child, reverts and says whom to ask', async ({
  page,
}) => {
  // Both ticks wait for the test, so the first is saved while the second is still running
  const release: Record<string, () => void> = {};
  let failing = '';
  await page.route('**/api/intern/pflege/anwesenheit/**/kinder/**', async (route) => {
    const url = route.request().url();
    await new Promise<void>((resolve) => (release[url] = resolve));
    if (url === failing) {
      await route.fulfill({
        status: 500,
        json: { error: 'Error', message: 'Internal Server Error' },
      });
    } else {
      await route.fallback();
    }
  });
  await page.goto('/leitendenbereich/anwesenheit');
  const ben = choice(page, 'Ben Beispiel');
  const anna = choice(page, 'Anna Test');
  await expect(anna.abwesend).toHaveAttribute('aria-pressed', 'true');

  const benRequest = page.waitForRequest('**/kinder/**');
  await ben.anwesend.click();
  const benUrl = (await benRequest).url();
  const annaRequest = page.waitForRequest(
    (request) => request.url().includes('/kinder/') && request.url() !== benUrl
  );
  await anna.anwesend.click();
  failing = (await annaRequest).url();

  await expect.poll(() => Object.keys(release).length).toBe(2);
  const benSaved = page.waitForResponse(benUrl);
  release[benUrl]();
  expect((await benSaved).ok()).toBe(true);
  await expect(page.getByText('Wird gespeichert …', { exact: true })).toBeVisible();
  release[failing]();

  const notice = page.getByRole('status').filter({ hasText: 'Anwesenheit von Anna' }).first();
  await expect(notice).toContainText(
    'Die Anwesenheit von Anna wurde nicht gespeichert. Tippe noch einmal auf deine Auswahl.'
  );
  await expect(notice).not.toContainText('Internal Server Error');
  await expect(notice.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toHaveAttribute(
    'href',
    'mailto:admin@stamm-phoenix.de'
  );
  await expect(anna.abwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(anna.anwesend).toHaveAttribute('aria-pressed', 'false');
  // The confirmation of Ben's choice does not stand next to the failure
  await expect(page.getByText('Gespeichert', { exact: true })).toHaveCount(0, { timeout: 1000 });

  // Restore the demo state for the following tests of this worker
  await page.unroute('**/api/intern/pflege/anwesenheit/**/kinder/**');
  await ben.abwesend.click();
  await expect(ben.abwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();
});

test('a child is either present or excused, never both, and the choice survives a reload', async ({
  page,
}) => {
  // Would break if the buttons were independent toggles, or if "Entschuldigt" was not saved
  await page.goto('/leitendenbereich/anwesenheit');
  const anna = choice(page, 'Anna Test');
  await expect(anna.abwesend).toHaveAttribute('aria-pressed', 'true');

  await anna.entschuldigt.click();
  await expect(anna.entschuldigt).toHaveAttribute('aria-pressed', 'true');
  await expect(anna.anwesend).toHaveAttribute('aria-pressed', 'false');
  await expect(anna.abwesend).toHaveAttribute('aria-pressed', 'false');
  const counts = page.getByTestId('anwesenheit-counts');
  await expect(counts).toContainText('0 anwesend, 1 entschuldigt, 3 abwesend');
  await expect(counts).toContainText('Gespeichert');

  await page.reload();
  await expect(choice(page, 'Anna Test').entschuldigt).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('anwesenheit-counts')).toContainText(
    '0 anwesend, 1 entschuldigt, 3 abwesend'
  );

  // Switching from excused to present replaces the excuse instead of adding to it
  await choice(page, 'Anna Test').anwesend.click();
  await expect(choice(page, 'Anna Test').anwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(choice(page, 'Anna Test').entschuldigt).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('anwesenheit-counts')).toContainText(
    '1 anwesend, 0 entschuldigt, 3 abwesend'
  );
  await page.reload();
  await expect(choice(page, 'Anna Test').anwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(choice(page, 'Anna Test').entschuldigt).toHaveAttribute('aria-pressed', 'false');

  // Restore the demo state for the following tests of this worker
  await choice(page, 'Anna Test').abwesend.click();
  await expect(choice(page, 'Anna Test').abwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('anwesenheit-counts')).toContainText('Gespeichert');
});

test('marking a Gruppenstunde as cancelled asks first, hides the attendance and survives a reload', async ({
  page,
}) => {
  // Would break if the attendance was deleted without asking, kept visible, or not saved
  await page.goto('/leitendenbereich/anwesenheit');
  await choice(page, 'Anna Test').anwesend.click();
  await expect(page.getByTestId('anwesenheit-counts')).toContainText('Gespeichert');
  const gruppenstunde = page.getByRole('group', { name: 'Gruppenstunde', exact: true });
  const ausgefallen = gruppenstunde.getByRole('button', { name: 'Ausgefallen', exact: true });
  const stattgefunden = gruppenstunde.getByRole('button', { name: 'Fand statt', exact: true });
  await expect(stattgefunden).toHaveAttribute('aria-pressed', 'true');

  // Cancelling the question changes nothing
  await ausgefallen.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Als ausgefallen markieren' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(stattgefunden).toHaveAttribute('aria-pressed', 'true');
  await expect(choice(page, 'Anna Test').anwesend).toHaveAttribute('aria-pressed', 'true');

  await ausgefallen.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Als ausgefallen markieren' }).click();
  await expect(page.getByText('Gruppenstunde als ausgefallen markiert.').first()).toBeVisible();
  await expect(ausgefallen).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Die Gruppenstunde ist ausgefallen.')).toBeVisible();
  await expect(choice(page, 'Anna Test').group).toHaveCount(0);
  await expect(page.getByLabel('Gast hinzufügen')).toHaveCount(0);
  await expect(page.getByLabel('Warum ist sie ausgefallen?')).toBeVisible();
  await expect(page.getByLabel(/Was habt ihr gemacht/)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Die Gruppenstunde ist ausgefallen.')).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Gruppenstunde', exact: true })
      .getByRole('button', { name: 'Ausgefallen', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(choice(page, 'Anna Test').group).toHaveCount(0);

  // Back to "Fand statt": no question, the children return without attendance
  await page
    .getByRole('group', { name: 'Gruppenstunde', exact: true })
    .getByRole('button', { name: 'Fand statt', exact: true })
    .click();
  await expect(page.getByText(/^Gruppenstunde als stattgefunden markiert\./).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(choice(page, 'Anna Test').abwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('anwesenheit-counts')).toContainText(
    '0 anwesend, 0 entschuldigt, 4 abwesend'
  );
  await expect(page.getByLabel(/Was habt ihr gemacht/)).toBeVisible();
  await page.reload();
  await expect(choice(page, 'Anna Test').abwesend).toHaveAttribute('aria-pressed', 'true');
});

test('unsaved notes survive a failed choice, and choices wait while „Ausgefallen“ saves', async ({
  page,
}) => {
  // Would break if a reload after a failed choice replaced the typed text, or if children
  // could be chosen while the Gruppenstunde is being marked as cancelled
  await page.goto('/leitendenbereich/anwesenheit');
  const anna = choice(page, 'Anna Test');
  await expect(anna.abwesend).toHaveAttribute('aria-pressed', 'true');
  const notes = page.getByLabel(/Was habt ihr gemacht/);
  await notes.fill('Noch nicht gespeichert.');

  await page.route('**/api/intern/pflege/anwesenheit/**/kinder/**', (route) =>
    route.fulfill({ status: 500, json: { error: 'Error', message: 'Internal Server Error' } })
  );
  await anna.anwesend.click();
  await expect(
    page.getByText(/Die Anwesenheit von Anna wurde nicht gespeichert/).first()
  ).toBeVisible();
  await expect(anna.abwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(notes).toHaveValue('Noch nicht gespeichert.');
  await page.unroute('**/api/intern/pflege/anwesenheit/**/kinder/**');

  let release = (): void => undefined;
  await page.route('**/api/intern/pflege/anwesenheit/**/ausgefallen', async (route) => {
    await new Promise<void>((resolve) => (release = resolve));
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Ausgefallen', exact: true }).click();
  await expect(anna.anwesend).toBeDisabled();
  release();
  await expect(page.getByText('Gruppenstunde als ausgefallen markiert.').first()).toBeVisible();
  await expect(page.getByLabel(/Warum ist sie ausgefallen/)).toHaveValue('Noch nicht gespeichert.');

  // Restore the demo state for the following tests of this worker
  await page.unroute('**/api/intern/pflege/anwesenheit/**/ausgefallen');
  await page.getByRole('button', { name: 'Fand statt', exact: true }).click();
  await expect(anna.abwesend).toBeEnabled();
});

test('the chosen status is filled in its colour with a check mark, "Abwesend" stays quiet', async ({
  page,
}) => {
  // Would break if the selection looked the same for all three states, as only a thin border
  // told them apart before
  await page.goto('/leitendenbereich/anwesenheit');
  const anna = choice(page, 'Anna Test');
  const ben = choice(page, 'Ben Beispiel');
  await anna.anwesend.click();
  await ben.entschuldigt.click();
  await expect(page.getByTestId('anwesenheit-counts')).toContainText('Gespeichert');

  await expect(anna.anwesend).toContainText('✓');
  await expect(ben.entschuldigt).toContainText('✓');
  await expect(choice(page, 'Clara Muster').abwesend).not.toContainText('✓');
  const fill = (button: ReturnType<typeof choice>['anwesend']) =>
    button.evaluate((element) => getComputedStyle(element).backgroundColor);
  const [present, excused, absent] = [
    await fill(anna.anwesend),
    await fill(ben.entschuldigt),
    await fill(choice(page, 'Clara Muster').abwesend),
  ];
  expect(new Set([present, excused, absent]).size).toBe(3);

  // Restore the demo state for the following tests of this worker
  await anna.abwesend.click();
  await ben.abwesend.click();
  await expect(page.getByTestId('anwesenheit-counts')).toContainText('0 anwesend');
});

test('a guest entered after someone cancelled the Gruppenstunde explains what happened', async ({
  page,
}) => {
  // Would break if the person only saw "Die Eingaben sind unvollständig oder ungültig."
  await page.goto('/leitendenbereich/anwesenheit');
  const iso = await page.getByLabel('Datum', { exact: true }).inputValue();
  await expect(choice(page, 'Anna Test').group).toBeVisible();
  // Another leader cancels it while this page is open
  const cancelled = await page.request.put(
    `/api/intern/pflege/anwesenheit/woelflinge/${iso}/ausgefallen`,
    { data: { cancelled: true, etag: null, entries: 0 } }
  );
  expect(cancelled.ok()).toBe(true);

  await page.getByLabel('Gast hinzufügen').fill('Spätgast');
  await page.getByRole('button', { name: 'Eintragen' }).click();
  await expect(
    page
      .getByText(/Spätgast wurde nicht als Gast eingetragen, weil jemand anderes .* ausgefallen/)
      .first()
  ).toBeVisible();
  // The page shows the Termin as it is now
  await expect(page.getByText('Die Gruppenstunde ist ausgefallen.')).toBeVisible();

  // Restore the demo state for the following tests of this worker
  await page
    .getByRole('group', { name: 'Gruppenstunde', exact: true })
    .getByRole('button', { name: 'Fand statt', exact: true })
    .click();
  await expect(choice(page, 'Anna Test').abwesend).toBeEnabled();
});

for (const failedReload of [false, true]) {
  test(`a note draft keeps its version through repeated reloads${failedReload ? ' including a load failure' : ''}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const date = failedReload ? '2026-08-19' : '2026-08-20';
    const read = `/api/intern/anwesenheit/woelflinge/${date}`;
    const write = `/api/intern/pflege/anwesenheit/woelflinge/${date}`;
    const initial = await page.request.put(write, {
      data: { notes: 'Ursprüngliche Notiz.', etag: null },
    });
    expect(initial.ok()).toBe(true);
    const { etag } = (await initial.json()) as { etag: string };

    await page.goto('/leitendenbereich/anwesenheit');
    await page.getByLabel('Datum', { exact: true }).fill(date);
    const notes = page.getByLabel(/Was habt ihr gemacht/);
    await expect(notes).toHaveValue('Ursprüngliche Notiz.');
    await notes.fill('Mein ungespeicherter Entwurf.');
    const other = await page.request.put(write, {
      data: { notes: 'Notiz der anderen Leitung.', etag },
    });
    expect(other.ok()).toBe(true);

    await page.route(`**${write}/kinder/**`, (route) => route.fulfill({ status: 500, json: {} }));
    if (failedReload) {
      await page.route(`**${read}`, (route) => route.fulfill({ status: 500, json: {} }));
      await choice(page, 'Anna Test').anwesend.click();
      await expect(page.getByText(/Der Termin konnte nicht geladen werden/)).toBeVisible();
      await page.unroute(`**${read}`);
      await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
      await expect(notes).toHaveValue('Mein ungespeicherter Entwurf.');
    }
    // Two successful reloads used to replace the draft's version with the other leader's.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reload = page.waitForResponse((response) => new URL(response.url()).pathname === read);
      await choice(page, 'Anna Test').anwesend.click();
      expect((await reload).ok()).toBe(true);
      await expect(choice(page, 'Anna Test').abwesend).toHaveAttribute('aria-pressed', 'true');
      await expect(notes).toHaveValue('Mein ungespeicherter Entwurf.');
    }

    const save = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === write && response.request().method() === 'PUT'
    );
    await page.getByRole('button', { name: 'Notiz speichern' }).click();
    expect([409, 412]).toContain((await save).status());
    await expect(
      page.getByText(/Jemand anderes hat die Notiz inzwischen geändert/).first()
    ).toBeVisible();
    await expect(notes).toHaveValue('Mein ungespeicherter Entwurf.');
    const stored = await (await page.request.get(read)).json();
    expect(stored.notes).toBe('Notiz der anderen Leitung.');
    await expectNoHorizontalOverflow(page);
  });
}

test('cancelling clears anonymized attendance before the Gruppenstunde is held and cancelled again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const date = '2026-09-18';
  await page.route(`**/api/intern/anwesenheit/woelflinge/${date}`, (route) =>
    route.fulfill({
      json: {
        stufe: 'Wölflinge',
        date,
        editable: true,
        etag: 'initial',
        notes: '',
        cancelled: false,
        children: [],
        guests: [],
        anonymized: 2,
        anonymizedExcused: 3,
        anonymizedGuests: 1,
      },
    })
  );
  const entries: number[] = [];
  await page.route(`**/api/intern/pflege/anwesenheit/woelflinge/${date}/ausgefallen`, (route) => {
    const body = route.request().postDataJSON() as { entries: number; cancelled: boolean };
    entries.push(body.entries);
    return route.fulfill(
      !body.cancelled || body.entries === (entries.length === 1 ? 6 : 0)
        ? { json: { etag: `version-${entries.length}` } }
        : { status: 409, json: { message: 'Die Anwesenheit wurde inzwischen geändert.' } }
    );
  });
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByLabel('Datum', { exact: true }).fill(date);
  const counts = page.getByTestId('anwesenheit-counts');
  await expect(counts).toContainText('2 anwesend, 3 entschuldigt, 0 abwesend, 1 Gast');
  const status = page.getByRole('group', { name: 'Gruppenstunde', exact: true });
  await status.getByRole('button', { name: 'Ausgefallen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Als ausgefallen markieren' }).click();
  await expect(page.getByText('Gruppenstunde als ausgefallen markiert.').first()).toBeVisible();
  await status.getByRole('button', { name: 'Fand statt', exact: true }).click();
  await expect(counts).toContainText('0 anwesend, 0 entschuldigt, 0 abwesend');
  await expect(counts).not.toContainText('Gast');
  await status.getByRole('button', { name: 'Ausgefallen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(status.getByRole('button', { name: 'Ausgefallen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(entries).toEqual([6, 0, 0]);
  await expectNoHorizontalOverflow(page);
});

test('notes and cancellation wait for each other without losing text or the current version', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const date = '2026-08-17';
  const write = `/api/intern/pflege/anwesenheit/woelflinge/${date}`;
  const read = `/api/intern/anwesenheit/woelflinge/${date}`;
  expect((await (await page.request.get(read)).json()).etag).toBeNull();
  let releaseCancel = (): void => undefined;
  const cancelGate = new Promise<void>((resolve) => {
    releaseCancel = resolve;
  });
  let cancelStored = false;
  let cancelRequests = 0;
  await page.route(`**${write}/ausgefallen`, async (route) => {
    cancelRequests++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    cancelStored = true;
    await cancelGate;
    await route.fulfill({ response });
  });
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByLabel('Datum', { exact: true }).fill(date);
  const notes = page.locator('#anwesenheit-inhalt');
  await expect(notes).toHaveValue('');
  await notes.fill('Mein Entwurf.');
  const save = page.getByRole('button', { name: 'Notiz speichern', exact: true });
  const status = page.getByRole('group', { name: 'Gruppenstunde', exact: true });
  await status.getByRole('button', { name: 'Ausgefallen', exact: true }).click();
  await expect.poll(() => cancelStored).toBe(true);
  await expect(save).toBeDisabled();
  // Even submitting the form directly must respect the pending cancellation.
  await notes.evaluate((element) =>
    element
      .closest('form')!
      .dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  );
  releaseCancel();
  await expect(page.getByText('Gruppenstunde als ausgefallen markiert.').first()).toBeVisible();
  await expect(notes).toHaveValue('Mein Entwurf.');

  let releaseNotes = (): void => undefined;
  const notesGate = new Promise<void>((resolve) => {
    releaseNotes = resolve;
  });
  let notesStored = false;
  await page.route(`**${write}`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    notesStored = true;
    await notesGate;
    await route.fulfill({ response });
  });
  await save.click();
  await expect.poll(() => notesStored).toBe(true);
  const held = status.getByRole('button', { name: 'Fand statt', exact: true });
  await expect(held).toBeDisabled();
  await held.evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  releaseNotes();
  await expect(page.getByText('Notiz gespeichert.').first()).toBeVisible();
  await expect(held).toBeEnabled();
  expect(cancelRequests).toBe(1);

  await notes.fill('Mein neuer Entwurf.');
  const nextSave = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === write && response.request().method() === 'PUT'
  );
  await save.click();
  expect((await nextSave).ok()).toBe(true);
  await expect(page.getByText('Notiz gespeichert.').first()).toBeVisible();
  await expect(save).toBeDisabled();
  const stored = await (await page.request.get(read)).json();
  expect(stored.notes).toBe('Mein neuer Entwurf.');
  expect(stored.cancelled).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('a reload after a failed child choice settles before notes save and cancellation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const date = '2026-08-16';
  const read = `/api/intern/anwesenheit/woelflinge/${date}`;
  const write = `/api/intern/pflege/anwesenheit/woelflinge/${date}`;
  await page.goto('/leitendenbereich/anwesenheit');
  await page.getByLabel('Datum', { exact: true }).fill(date);
  const notes = page.locator('#anwesenheit-inhalt');
  await expect(notes).toHaveValue('');
  await notes.fill('Mein Entwurf bleibt.');
  await page.route(`**${write}/kinder/**`, (route) => route.fulfill({ status: 500, json: {} }));
  let releaseLoad = (): void => undefined;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let loadCaptured = false;
  await page.route(`**${read}`, async (route) => {
    const response = await route.fetch();
    loadCaptured = true;
    await loadGate;
    await route.fulfill({ response });
  });
  let writes = 0;
  let releaseSave = (): void => undefined;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**${write}`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    writes++;
    await saveGate;
    await route.fulfill({ response });
  });
  await choice(page, 'Anna Test').anwesend.click();
  await expect.poll(() => loadCaptured).toBe(true);
  const save = page.getByRole('button', { name: 'Notiz speichern', exact: true });
  const cancel = page
    .getByRole('group', { name: 'Gruppenstunde', exact: true })
    .getByRole('button', { name: 'Ausgefallen', exact: true });
  await expect(save).toBeDisabled();
  await expect(cancel).toBeDisabled();
  await notes.evaluate((element) =>
    element
      .closest('form')!
      .dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  );
  releaseLoad();
  await expect(save).toBeEnabled();
  expect(writes).toBe(0);
  await expect(notes).toHaveValue('Mein Entwurf bleibt.');
  await save.click();
  await expect.poll(() => writes).toBe(1);
  // Another failed choice cannot start a stale reload during the notes write either.
  await expect(choice(page, 'Anna Test').anwesend).toBeDisabled();
  releaseSave();
  await expect(page.getByText('Notiz gespeichert.').first()).toBeVisible();
  await cancel.click();
  await expect(page.getByText('Gruppenstunde als ausgefallen markiert.').first()).toBeVisible();
  const stored = await (await page.request.get(read)).json();
  expect(stored.notes).toBe('Mein Entwurf bleibt.');
  expect(stored.cancelled).toBe(true);
  await expect(notes).toHaveValue('Mein Entwurf bleibt.');
});

for (const guests of [1, 2]) {
  test(`cancelling waits for a guest deletion and blocks further deletions (${guests} guests)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const date = guests === 1 ? '2026-08-14' : '2026-08-13';
    const write = `/api/intern/pflege/anwesenheit/woelflinge/${date}`;
    const read = `/api/intern/anwesenheit/woelflinge/${date}`;
    for (let index = 0; index < guests; index++) {
      expect(
        (await page.request.post(`${write}/gaeste`, { data: { name: `Gast ${index + 1}` } })).ok()
      ).toBe(true);
    }
    let releaseDelete = (): void => undefined;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deletes = 0;
    await page.route(`**${write}/gaeste/*`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      deletes++;
      await deleteGate;
      await route.fulfill({ response });
    });
    let releaseCancel = (): void => undefined;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const entries: number[] = [];
    await page.route(`**${write}/ausgefallen`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      entries.push((route.request().postDataJSON() as { entries: number }).entries);
      await cancelGate;
      await route.fulfill({ response });
    });
    await page.goto('/leitendenbereich/anwesenheit');
    await page.getByLabel('Datum', { exact: true }).fill(date);
    const remove = page.getByRole('button', { name: 'Gast 1 entfernen', exact: true });
    await remove.click();
    await expect.poll(() => deletes).toBe(1);
    const cancel = page
      .getByRole('group', { name: 'Gruppenstunde', exact: true })
      .getByRole('button', { name: 'Ausgefallen', exact: true });
    await expect(cancel).toBeDisabled();
    await expect(remove).toBeDisabled();
    await cancel.evaluate((button) =>
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    releaseDelete();
    await expect(remove).toHaveCount(0);
    expect(entries).toEqual([]);
    await cancel.click();
    if (guests > 1) {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Als ausgefallen markieren', exact: true })
        .click();
    }
    await expect.poll(() => entries.length).toBe(1);
    if (guests > 1) {
      const remaining = page.getByRole('button', { name: 'Gast 2 entfernen', exact: true });
      await expect(remaining).toBeDisabled();
      await remaining.evaluate((button) =>
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      );
    }
    releaseCancel();
    await expect(page.getByText('Gruppenstunde als ausgefallen markiert.').first()).toBeVisible();
    expect(entries).toEqual([guests - 1]);
    expect(deletes).toBe(1);
    const stored = await (await page.request.get(read)).json();
    expect(stored.cancelled).toBe(true);
    expect(stored.guests).toEqual([]);
  });
}
