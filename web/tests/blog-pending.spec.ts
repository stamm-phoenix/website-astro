import { test, expect } from './fixtures';

for (const status of [500, 401]) {
  test(`failed workflow (${status}) preserves feedback and navigation protection`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let release = (): void => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/intern/pflege/blog/700', async (route) => {
      if (route.request().method() === 'PATCH') {
        await pending;
        await route.fulfill({ status, json: {} });
      } else {
        await route.fulfill({
          json: {
            id: '700',
            etag: '1',
            title: 'Prüfung',
            date: '2026-08-14',
            content: '<p>Bericht</p>',
            images: [],
            published: false,
            workflow: { state: 'review' },
          },
        });
      }
    });
    await page.goto('/leitendenbereich/blog/beitrag?id=700');
    await page.getByLabel('Rückmeldung bei Rückgabe').fill('Bitte Datum prüfen.');
    await page.getByRole('button', { name: 'Mit Rückmeldung zurückgeben', exact: true }).click();
    await expect(page.getByText('Wird geändert …', { exact: true })).toBeVisible();
    expect(await page.locator('#blog-title').evaluate((node) => !!node.closest('[inert]'))).toBe(
      true
    );
    release();
    if (status === 401)
      await expect(
        page.getByRole('alert').getByRole('link', { name: 'Neu anmelden' })
      ).toBeVisible();
    else await expect(page.getByRole('alert')).toContainText('Der Stand wurde nicht geändert.');
    await expect(page.getByLabel('Rückmeldung bei Rückgabe')).toHaveValue('Bitte Datum prüfen.');
    expect(
      await page.evaluate(
        () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
      )
    ).toBe(true);
    await page
      .locator('a[href="/leitendenbereich/blog"]')
      .filter({ visible: true })
      .first()
      .click({ noWaitAfter: true });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click();
    await expect(page.getByLabel('Rückmeldung bei Rückgabe')).toHaveValue('Bitte Datum prüfen.');
  });
}
