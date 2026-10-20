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
  await expect(page.getByText(/^1 Kind da\./)).toContainText('Gespeichert');

  await page.getByLabel('Gast hinzufügen').fill('Testgast Schnuppern');
  await page.getByRole('button', { name: 'Eintragen' }).click();
  await expect(
    page.getByText('Testgast Schnuppern ist als Gast eingetragen.').first()
  ).toBeVisible();
  await expect(page.getByText(/^1 Kind da, dazu 1 Gast\./)).toBeVisible();

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
  const counts = page.getByText(/Kind(er)? da/).first();
  await expect(counts).toContainText('0 Kinder da, 1 entschuldigt.');
  await expect(counts).toContainText('Gespeichert');

  await page.reload();
  await expect(choice(page, 'Anna Test').entschuldigt).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Kind(er)? da/).first()).toContainText('0 Kinder da, 1 entschuldigt.');

  // Switching from excused to present replaces the excuse instead of adding to it
  await choice(page, 'Anna Test').anwesend.click();
  await expect(choice(page, 'Anna Test').anwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(choice(page, 'Anna Test').entschuldigt).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Kind(er)? da/).first()).toContainText('1 Kind da.');
  await expect(page.getByText(/Kind(er)? da/).first()).not.toContainText('entschuldigt');
  await page.reload();
  await expect(choice(page, 'Anna Test').anwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(choice(page, 'Anna Test').entschuldigt).toHaveAttribute('aria-pressed', 'false');

  // Restore the demo state for the following tests of this worker
  await choice(page, 'Anna Test').abwesend.click();
  await expect(choice(page, 'Anna Test').abwesend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Kind(er)? da/).first()).toContainText('Gespeichert');
});

test('marking a Gruppenstunde as cancelled asks first, hides the attendance and survives a reload', async ({
  page,
}) => {
  // Would break if the attendance was deleted without asking, kept visible, or not saved
  await page.goto('/leitendenbereich/anwesenheit');
  await choice(page, 'Anna Test').anwesend.click();
  await expect(page.getByText(/Kind(er)? da/).first()).toContainText('Gespeichert');
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
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Als ausgefallen markieren' })
    .click();
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
  await expect(page.getByText(/Kind(er)? da/).first()).toContainText('0 Kinder da.');
  await expect(page.getByLabel(/Was habt ihr gemacht/)).toBeVisible();
  await page.reload();
  await expect(choice(page, 'Anna Test').abwesend).toHaveAttribute('aria-pressed', 'true');
});
