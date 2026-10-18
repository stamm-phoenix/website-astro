import { test, expect, expectNoHorizontalOverflow } from './fixtures';

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

  // Ticks save on their own, which the page says before and after a tap
  await expect(page.getByText('Häkchen werden sofort gespeichert.')).toBeVisible();
  const anna = page.getByRole('button', { name: 'Anna Test' });
  await expect(anna).toHaveAttribute('aria-pressed', 'false');
  await anna.click();
  await expect(anna).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.getByRole('button', { name: 'Anna Test' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByLabel(/Was habt ihr gemacht/)).toHaveValue('Schnitzeljagd im Wald.');

  await page.getByRole('button', { name: 'Verlauf & Statistik' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Restore the demo state for the following tests of this worker
  await page.getByRole('button', { name: 'Erfassen' }).click();
  await page.getByRole('button', { name: 'Testgast Schnuppern entfernen' }).click();
  await expect(
    page.getByText('Testgast Schnuppern ist nicht mehr eingetragen.').first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Anna Test' }).click();
  await expect(page.getByRole('button', { name: 'Anna Test' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.getByLabel(/Was habt ihr gemacht/).fill('');
  await page.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(page.getByText('Notiz gespeichert.').first()).toBeVisible();
});

test('a tick that fails to save names the child, reverts and says whom to ask', async ({
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
  const ben = page.getByRole('button', { name: 'Ben Beispiel' });
  const anna = page.getByRole('button', { name: 'Anna Test' });
  await expect(anna).toHaveAttribute('aria-pressed', 'false');

  const benRequest = page.waitForRequest('**/kinder/**');
  await ben.click();
  const benUrl = (await benRequest).url();
  const annaRequest = page.waitForRequest(
    (request) => request.url().includes('/kinder/') && request.url() !== benUrl
  );
  await anna.click();
  failing = (await annaRequest).url();

  await expect.poll(() => Object.keys(release).length).toBe(2);
  const benSaved = page.waitForResponse(benUrl);
  release[benUrl]();
  expect((await benSaved).ok()).toBe(true);
  await expect(page.getByText('Wird gespeichert …', { exact: true })).toBeVisible();
  release[failing]();

  const notice = page.getByRole('status').filter({ hasText: 'Anwesenheit von Anna' }).first();
  await expect(notice).toContainText(
    'Die Anwesenheit von Anna wurde nicht gespeichert. Tippe noch einmal auf den Namen.'
  );
  await expect(notice).not.toContainText('Internal Server Error');
  await expect(notice.getByRole('link', { name: 'admin@stamm-phoenix.de' })).toHaveAttribute(
    'href',
    'mailto:admin@stamm-phoenix.de'
  );
  await expect(anna).toHaveAttribute('aria-pressed', 'false');
  // The confirmation of Ben's tick does not stand next to the failure
  await expect(page.getByText('Gespeichert', { exact: true })).toHaveCount(0, { timeout: 1000 });

  // Restore the demo state for the following tests of this worker
  await page.unroute('**/api/intern/pflege/anwesenheit/**/kinder/**');
  await ben.click();
  await expect(ben).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();
});
