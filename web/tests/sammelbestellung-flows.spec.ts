import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('a personal order link is requested with the proof of work, also twice in a row', async ({
  page,
}) => {
  await page.goto('/mitgliederbereich/sammelbestellungen#kind=campaign&id=101&token=mock');
  const button = page.getByRole('button', { name: 'Bestelllink per E-Mail erhalten' });
  await page.getByLabel('E-Mail-Adresse').fill('kaputt');
  await button.click();
  await expect(page.getByText('Bitte gib eine gültige E-Mail-Adresse ein.')).toBeVisible();
  await page.getByLabel('E-Mail-Adresse').fill('familie@example.test');
  for (let attempt = 0; attempt < 2; attempt++) {
    // Submitting while the widget still works must not be blocked by its required checkbox.
    const request = page.waitForRequest((req) => req.url().endsWith('/request-link'));
    await button.click();
    expect(typeof (await request).postDataJSON().altcha).toBe('string');
    // The live region, not its popup copy that appears when the notice is out of view.
    await expect(
      page.getByRole('status').getByText(/Dein persönlicher Bestelllink kommt per E-Mail/)
    ).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
});

test('stale order save reports a conflict and retains the draft', async ({
  page,
  request,
}, testInfo) => {
  await page.goto('/mitgliederbereich/sammelbestellungen#kind=order&id=2001&token=mock');
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  const draft = `Mein ungespeicherter Entwurf ${testInfo.project.name}`;
  await page.getByLabel('Name', { exact: true }).fill(draft);
  // A second actor updates the same fixture, producing a real stale ETag response.
  const response = await request.post('/api/sammelbestellungen/order', {
    data: { id: '2001', token: 'mock' },
  });
  expect(response.headers()['x-mock-api']).toBe('1');
  const view = await response.json();
  const changed = await request.patch('/api/intern/pflege/sammelbestellungen/orders/2001', {
    data: { etag: view.order.etag, status: 'Eingereicht', paid: false, delivered: false },
  });
  expect(changed.status()).toBe(204);
  const saveResponse = page.waitForResponse(
    (res) => res.url().endsWith('/api/sammelbestellungen/order') && res.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  expect((await saveResponse).status()).toBe(409);
  await expect(page.getByText(/wurde inzwischen geändert/)).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(draft);
  await page.getByRole('button', { name: 'Bestellung neu laden' }).click();
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue(draft);
  await expectNoHorizontalOverflow(page);
});

test('catalog add confirms the article and jumps to its fields', async ({ page }) => {
  await page.goto('/mitgliederbereich/sammelbestellungen#kind=order&id=2002&token=mock');
  await page.getByRole('button', { name: 'Pfadfinderhut hinzufügen', exact: true }).click();
  const popup = page.getByRole('status').filter({ hasText: 'wurde als Artikel 2 hinzugefügt' });
  await expect(popup).toContainText('„Pfadfinderhut“');
  await popup.getByRole('button', { name: 'Zum Artikel', exact: true }).click();
  await expect(page.locator('#article-variant-1')).toBeFocused();
  await expect(popup).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('group order saves member changes and loads staff detail routes', async ({
  page,
}, testInfo) => {
  await page.goto('/mitgliederbereich/sammelbestellungen#kind=order&id=2002&token=mock');
  await expect(page.getByRole('button', { name: 'Gespeichert', exact: true })).toBeDisabled();
  const note = `Demo-Bestellung ${testInfo.project.name}`;
  await page.getByLabel('Bemerkungen', { exact: false }).fill(note);
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  // When the notice is scrolled away, a popup repeats it; at least one of them must be in view.
  await expect
    .poll(() =>
      page.getByText(/Deine Bestellung wurde gespeichert/).evaluateAll((notices) =>
        notices.some((notice) => {
          const rect = notice.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
          );
        })
      )
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel('Bemerkungen', { exact: false })).toHaveValue(note);
  await expectNoHorizontalOverflow(page);
  await page.goto('/leitendenbereich/sammelbestellungen/101');
  await expect(
    page.getByRole('heading', { name: 'Kluft & Halstücher Herbst 2026', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Mia Bauer', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('removing an article confirms it and keeps the focus in the list', async ({ page }) => {
  await page.goto('/mitgliederbereich/sammelbestellungen#kind=order&id=2002&token=mock');
  await page.getByRole('button', { name: 'Pfadfinderhut hinzufügen', exact: true }).click();
  await page.getByRole('button', { name: 'Artikel 2 entfernen', exact: true }).click();
  await expect(page.getByText('„Pfadfinderhut“ wurde entfernt.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Anderen Artikel hinzufügen', exact: true })
  ).toBeFocused();
});

test('staff order filters and the export shop survive reloading the campaign', async ({ page }) => {
  await page.goto('/leitendenbereich/sammelbestellungen/101');
  const orders = page.getByRole('region', { name: 'Bestellungen', exact: true });
  await page.getByLabel('Nach Name oder E-Mail suchen').fill('Mayr');
  await orders.getByRole('button', { name: 'Unbezahlt', exact: true }).click();
  const finished = page.getByLabel('Erledigte und stornierte Bestellungen anzeigen');
  await finished.check();
  const shop = page.getByLabel('CSV für', { exact: true });
  const selected = await shop.locator('option').nth(1).getAttribute('value');
  await shop.selectOption(selected!);
  await orders.getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(page.getByLabel('Nach Name oder E-Mail suchen')).toHaveValue('Mayr');
  await expect(orders.getByRole('button', { name: 'Unbezahlt', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(finished).toBeChecked();
  await expect(shop).toHaveValue(selected!);
});
