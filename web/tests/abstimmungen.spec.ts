import { expect, test } from './fixtures';

test('a leader creates an Abstimmung, invites, and a guest votes over the shared link', async ({
  page,
  browser,
}) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('button', { name: 'Abstimmung anlegen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Abstimmung' });
  await dialog.getByRole('textbox', { name: 'Frage' }).fill('Wann ist die nächste Leiterrunde?');
  await dialog.getByLabel('Datum', { exact: true }).fill('2026-11-14');
  await dialog.getByLabel('Uhrzeit (optional)').fill('18:00');
  await dialog.getByRole('button', { name: 'Termin hinzufügen' }).click();
  await dialog.getByLabel('Datum', { exact: true }).fill('2026-11-21');
  await dialog.getByRole('button', { name: 'Termin hinzufügen' }).click();
  await expect(dialog.getByLabel('Option 1', { exact: true })).toHaveValue(
    'Sa, 14.11.2026, 18:00 Uhr'
  );
  await expect(dialog.getByLabel('Option 2', { exact: true })).toHaveValue('Sa, 21.11.2026');
  await dialog.getByRole('button', { name: 'Abstimmung anlegen' }).click();

  await expect(
    page.getByRole('heading', { name: 'Wann ist die nächste Leiterrunde?' })
  ).toBeVisible();
  await page.getByLabel('Sa, 14.11.2026, 18:00 Uhr').check();
  await page.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(page.getByText('Antwort gespeichert.').first()).toBeVisible();
  await expect(page.getByText('Du hast abgestimmt')).toBeVisible();

  await page.getByRole('button', { name: 'Per Mail einladen' }).click();
  await page
    .getByRole('dialog', { name: 'Zur Abstimmung einladen' })
    .getByRole('button', { name: /Personen einladen$/ })
    .click();
  // The mails go out a few per request
  await expect(page.getByText('Einladungen verschickt.').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Eingeladen: \d+, davon 0 abgestimmt$/)).toBeVisible();

  const shared = await page.getByText(/\/abstimmung#link=/).textContent();
  const guest = await browser.newPage();
  await guest.goto(shared!.trim());
  await guest.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(guest.getByText('Bitte gib deinen Namen ein.')).toBeVisible();
  await guest.getByLabel('Dein Name').fill('Oma Erna');
  await guest.getByLabel('Sa, 21.11.2026').check();
  await guest.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(guest.getByText('Antwort gespeichert.').first()).toBeVisible();
  // The page switched to the personal link, so a reload keeps the answer
  await expect(guest).toHaveURL(/#t=/);
  await guest.reload();
  await expect(guest.getByLabel('Dein Name')).toHaveValue('Oma Erna');
  await expect(guest.getByLabel('Sa, 21.11.2026')).toBeChecked();
  await guest.close();

  await page.getByRole('button', { name: 'Abstimmung beenden' }).click();
  await page
    .getByRole('dialog', { name: /beenden\?$/ })
    .getByRole('button', { name: 'Abstimmung beenden' })
    .click();
  await expect(page.getByText('Abstimmung beendet.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wieder öffnen' })).toBeVisible();
  await expect(page.getByText('Oma Erna')).toBeVisible();
});

test('an Abstimmung of someone else can be answered but not managed', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('link', { name: /Termin für die Weihnachtsfeier/ }).click();
  await expect(page.getByRole('heading', { name: 'Termin für die Weihnachtsfeier' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Per Mail einladen' })).toHaveCount(0);
  await page.getByLabel('Fr, 18.12.2026, 19:00 Uhr').check();
  await page.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(page.getByText('Antwort gespeichert.').first()).toBeVisible();
});

test('emptying an option with votes warns that its votes are lost', async ({ page }) => {
  await page.request.post('/api/__mock/abstimmungen/reset');
  await page.goto('/leitendenbereich/abstimmungen');
  await page.getByRole('link', { name: /Was essen wir auf dem Sommerlager/ }).click();
  await page.getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Abstimmung bearbeiten' });
  await dialog.getByLabel('Option 3', { exact: true }).fill('');
  await expect(
    dialog.getByText('Beim Speichern gehen die Stimmen für „Kässpatzn“ verloren.')
  ).toBeVisible();
});
