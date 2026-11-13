import { test, expect } from './fixtures';
import type { CampflowEvent } from '../src/lib/types/aktionen';

test('an invalid receipt announces errors and takes the user to the first correction', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/belege');
  await page.getByRole('button', { name: 'Beleg einreichen', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Beleg einreichen' });
  await dialog.getByRole('button', { name: 'Einreichen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('markierten');
  await expect(dialog.locator('[aria-invalid="true"]').first()).toBeFocused();
  await expect(dialog.getByLabel('Datum des Belegs', { exact: true })).not.toHaveValue('');
});

test('custom participant fields remain selectable and the choice survives a reload', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aktionen/aktion?id=evt_Sola26');
  const filter = page.getByRole('search', { name: 'Teilnehmende filtern' });
  await filter.getByText(/^Spalten \(/).click();
  const photoPermission = filter.getByRole('checkbox', { name: 'Fotoerlaubnis', exact: true });
  await expect(photoPermission).not.toBeChecked();
  await photoPermission.check();
  await page.reload();
  await page
    .getByRole('search', { name: 'Teilnehmende filtern' })
    .getByText(/^Spalten \(/)
    .click();
  await expect(page.getByRole('checkbox', { name: 'Fotoerlaubnis', exact: true })).toBeChecked();
});

test('a missing receipt source is announced while the available receipts remain usable', async ({
  page,
}) => {
  await page.route('**/api/intern/pflege/belege/campflow*', (route) =>
    route.fulfill({
      status: 502,
      json: { message: 'Die Belege aus CampFlow konnten nicht geladen werden.' },
    })
  );
  await page.goto('/leitendenbereich/belege');
  const alert = page.getByRole('alert').filter({ hasText: 'Die Belegliste ist unvollständig.' });
  await expect(alert).toBeVisible();
  await expect(
    alert.getByRole('button', { name: 'Belege aus CampFlow erneut laden' })
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Belege' }).getByRole('listitem').first()
  ).toBeVisible();
});

test('suspected orders stay actions until a person explicitly confirms their classification', async ({
  page,
  request,
}) => {
  const events = (await (await request.get('/api/intern/aktionen')).json()) as CampflowEvent[];
  const order = events.find((event) => event.id === 'evt_Stammespulli')!;
  await page.route('**/api/intern/aktionen', (route) =>
    route.fulfill({
      json: events.map((event) =>
        event.id === order.id ? { ...event, keineAktion: false } : event
      ),
    })
  );
  let writes = 0;
  await page.route(`**/api/intern/pflege/aktionen-art/${order.id}`, async (route) => {
    writes++;
    await route.fulfill({ json: { keineAktion: true, zuschussfaehig: false } });
  });
  await page.goto('/leitendenbereich/aktionen');
  const review = page.locator('details').filter({ hasText: 'Bestellungen und Vorlagen prüfen' });
  await review.locator('summary').click();
  const entry = review.getByRole('listitem').filter({ hasText: order.title });
  await entry.getByRole('button', { name: 'Aus Aktionen ausblenden', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: `„${order.title}“ aus Aktionen ausblenden?`,
  });
  await expect(confirmation).toBeVisible();
  expect(writes).toBe(0);
  await confirmation.getByRole('button', { name: 'Aus Aktionen ausblenden', exact: true }).click();
  await expect(
    page
      .getByText(`„${order.title}“ wird nicht mehr als Aktion angezeigt.`, { exact: true })
      .first()
  ).toBeVisible();
  expect(writes).toBe(1);
  await expect(entry).toHaveCount(0);
});

test('the mobile menu isolates the page and restores it on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  const menu = page.getByRole('button', { name: 'Menü', exact: true });
  await menu.click();
  const dialog = page.getByRole('dialog', { name: 'Alle Bereiche' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('header').first()).toHaveAttribute('inert', '');
  await dialog.getByRole('link', { name: 'Zur Website', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(page.locator('header').first()).not.toHaveAttribute('inert', '');
});

test('a failed receipt refresh keeps the previous data and labels it as an older stand', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/belege');
  await expect(
    page
      .getByRole('group', { name: 'Belege auswählen' })
      .getByRole('button', { name: /^In CampFlow/ })
  ).toContainText('(5)');
  await page.route('**/api/intern/pflege/belege/campflow*', (route) =>
    route.fulfill({
      status: 502,
      json: { message: 'Die Belege aus CampFlow konnten nicht geladen werden.' },
    })
  );
  await page.getByRole('button', { name: 'Neu laden', exact: true }).first().click();
  const alert = page
    .getByRole('alert')
    .filter({ hasText: 'Die Belege konnten nicht aktualisiert werden.' });
  await expect(alert).toContainText('Angezeigt wird der zuletzt geladene Stand.');
  await page
    .getByRole('group', { name: 'Belege auswählen' })
    .getByRole('button', { name: /^In CampFlow/ })
    .click();
  await expect(page.getByRole('list', { name: 'Belege' }).getByRole('listitem')).toHaveCount(5);
});

test('a first visit shows common tasks before the overview cards and explains their purpose', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const endpoint of ['favoriten', 'zuletzt']) {
    await page.route(`**/api/intern/${endpoint}`, (route) =>
      route.fulfill({ json: { modules: [] } })
    );
  }
  await page.goto('/leitendenbereich');
  const common = page.getByRole('region', { name: 'Oft genutzt', exact: true });
  await expect(common.getByRole('link', { name: /^Belege/ })).toBeInViewport();
  await expect(common).toContainText('Kassenbelege fotografieren und einreichen');
  const positions = await page.evaluate(() => ({
    common: [...document.querySelectorAll('h2')]
      .find((heading) => heading.textContent?.trim() === 'Oft genutzt')!
      .getBoundingClientRect().top,
    overview: document.querySelector('#for-you-heading')!.getBoundingClientRect().top,
  }));
  expect(positions.common).toBeLessThan(positions.overview);
  await page.screenshot({ path: testInfo.outputPath('erster-besuch-390.png') });
});

test(
  'common tasks remain below personal areas for returning leaders',
  { tag: '@mobile' },
  async ({ page }, testInfo) => {
    await page.setViewportSize({
      width: testInfo.project.name === 'mobile' ? 390 : 1536,
      height: 960,
    });
    await page.route('**/api/intern/favoriten', (route) =>
      route.fulfill({ json: { modules: ['/leitendenbereich/aufgaben'] } })
    );
    await page.route('**/api/intern/zuletzt', (route) =>
      route.fulfill({ json: { modules: ['/leitendenbereich/mitglieder'] } })
    );
    await page.goto('/leitendenbereich');
    const personal = page.getByRole('region', { name: 'Deine Bereiche', exact: true });
    await expect(personal.getByRole('link', { name: 'Aufgaben', exact: true })).toBeVisible();
    await expect(personal.getByRole('link', { name: 'Mitglieder', exact: true })).toBeVisible();
    const common = page.getByRole('region', { name: 'Oft genutzt', exact: true });
    await expect(common.getByRole('link', { name: /^Belege/ })).toBeVisible();
    expect((await personal.boundingBox())!.y).toBeLessThan((await common.boundingBox())!.y);
    await page.screenshot({ path: testInfo.outputPath('oft-genutzt.png') });
  }
);
