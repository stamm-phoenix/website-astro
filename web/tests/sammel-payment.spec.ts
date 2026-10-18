import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { SammelStaffView, SammelPaymentView, SammelPaymentPreview } from '../src/lib/types';

test('payment review explains mapping setup and retains dialog confirmation guards', async ({
  page,
}) => {
  const response = await page.request.get('/api/intern/pflege/sammelbestellungen/101');
  const staff = (await response.json()) as SammelStaffView;
  const order = staff.orders.find((entry) => entry.id === '2003')!;
  const view: SammelPaymentView = {
    campaignArchived: staff.campaign.archived,
    order,
    record: {
      version: 1,
      assignment: {
        person: { id: 'per_Test', name: 'Familie Mayr', emails: [order.email], matchesEmail: true },
        reason: '',
        confirmedBy: { id: 'staff', name: 'Demo' },
        confirmedAt: '2026-10-01T12:00:00Z',
      },
      operation: null,
      dispatch: null,
      settlement: null,
    },
    events: [],
    creationEnabled: true,
  };
  const preview: SammelPaymentPreview = {
    etag: order.etag,
    personName: 'Familie Mayr',
    hash: 'a'.repeat(64),
    snapshot: {
      personId: 'per_Test',
      amount: order.totalCents!,
      description: `Bestellung ${order.id}`,
      orderId: order.id,
      campaignId: order.campaignId,
      revision: 'b'.repeat(64),
      attachedExpense: { costunitName: staff.campaign.title, categoryName: 'Bestellungen' },
    },
  };
  const actions: string[] = [];
  await page.route('**/api/intern/pflege/sammelbestellungen/orders/2003/payment', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: view });
    else {
      const action = route.request().postDataJSON().action;
      actions.push(action);
      expect(action).toBe('preview');
      await route.fulfill({ json: preview });
    }
  });
  await page.goto('/leitendenbereich/sammelbestellungen/101');
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Familie Mayr', exact: true }) })
    .getByRole('button', { name: 'Bezahlung verwalten' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Bezahlung über CampFlow' });
  await dialog.getByRole('button', { name: 'Beitrag vorbereiten', exact: true }).click();
  await expect(dialog.getByText(/Fehlende Kostenstellen und Kategorien werden/)).toBeVisible();
  await expect(dialog.getByText(/wirtschaftlichen\s+Geschäftsbetrieb/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('payment-review.png') });
  await dialog.getByRole('button', { name: 'Beitrag anlegen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Bestätigung ankreuzen/);
  expect(actions).toEqual(['preview']);
  const confirmation = dialog.getByRole('checkbox', { name: /Person und endgültiger Betrag/ });
  await confirmation.check();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  await page
    .getByRole('dialog', { name: 'Änderungen verwerfen?' })
    .getByRole('button', { name: 'Weiter bearbeiten', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await confirmation.uncheck();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  await expect(dialog).not.toBeVisible();
  // The merged EditDialog must also prevent submit-by-Enter for unavailable orders.
  view.order.submitted = false;
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Familie Mayr', exact: true }) })
    .getByRole('button', { name: 'Bezahlung verwalten' })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Beitrag vorbereiten', exact: true })
  ).toBeDisabled();
  await dialog.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
  expect(actions).toEqual(['preview']);
});

for (const condition of [
  'archived',
  'newly-archived',
  'unsubmitted',
  'cancelled',
  'paid',
] as const) {
  test(`person assignment respects ${condition} orders`, async ({ page }) => {
    const response = await page.request.get('/api/intern/pflege/sammelbestellungen/101');
    const staff = (await response.json()) as SammelStaffView;
    // The payment GET may return newer eligibility data than the staff list.
    const order = structuredClone(staff.orders.find((entry) => entry.id === '2003')!);
    staff.campaign.archived = condition === 'archived';
    order.submitted = condition !== 'unsubmitted';
    if (condition === 'cancelled') order.status = 'Storniert';
    order.paid = condition === 'paid';
    const view: SammelPaymentView = {
      campaignArchived: condition === 'archived' || condition === 'newly-archived',
      order,
      record: null,
      events: [],
      creationEnabled: true,
    };
    const person = {
      id: 'per_Test',
      name: 'Familie Mayr',
      emails: [order.email],
      matchesEmail: true,
    };
    const actions: string[] = [];
    let personRequests = 0;
    await page.route('**/api/intern/pflege/sammelbestellungen/101', (route) =>
      route.fulfill({ json: staff })
    );
    await page.route(
      '**/api/intern/pflege/sammelbestellungen/orders/2003/payment/persons',
      (route) => {
        personRequests++;
        return route.fulfill({ json: [person] });
      }
    );
    await page.route(
      '**/api/intern/pflege/sammelbestellungen/orders/2003/payment',
      async (route) => {
        if (route.request().method() === 'POST') {
          actions.push(route.request().postDataJSON().action);
          expect(actions).toEqual(['assign']);
          view.record = {
            version: 1,
            assignment: {
              person,
              reason: '',
              confirmedBy: { id: 'staff', name: 'Demo' },
              confirmedAt: '2026-10-01T12:00:00Z',
            },
            operation: null,
            dispatch: null,
            settlement: null,
          };
        }
        await route.fulfill({ json: view });
      }
    );
    await page.goto('/leitendenbereich/sammelbestellungen/101');
    await page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: 'Familie Mayr', exact: true }) })
      .getByRole('button', { name: 'Bezahlung verwalten' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Bezahlung über CampFlow' });
    const submit = dialog.getByRole('button', { name: 'Person bestätigen', exact: true });
    if (condition === 'paid') {
      await expect(submit).toBeEnabled();
      await dialog.getByRole('checkbox').check();
      await submit.click();
      await expect(
        dialog.getByRole('button', { name: 'Beitrag zuordnen', exact: true })
      ).toBeEnabled();
      await expect(dialog.getByText(/vorhandenen CampFlow-Beitrag kannst du/)).toBeVisible();
      expect(actions).toEqual(['assign']);
      expect(personRequests).toBe(1);
    } else {
      await expect(submit).toBeDisabled();
      await expect(
        dialog.getByText(/Dafür kann keine CampFlow-Person zugeordnet werden/)
      ).toBeVisible();
      await expect(dialog.getByLabel('CampFlow-Person')).toHaveCount(0);
      await dialog.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
      expect(actions).toEqual([]);
      expect(personRequests).toBe(0);
    }
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`assignment-${condition}.png`) });
  });
}

test('an unreadable payment response explains recovery in German', async ({ page }) => {
  await page.route('**/api/intern/pflege/sammelbestellungen/orders/*/payment', (route) =>
    route.fulfill({ status: 503, body: 'upstream unavailable' })
  );
  await page.goto('/leitendenbereich/sammelbestellungen/101');
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Mia Bauer', exact: true }) })
    .getByRole('button', { name: 'Bezahlung verwalten', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Bezahlung über CampFlow', exact: true });
  await expect(dialog.getByRole('alert')).toContainText(
    'Die Zahlungsdaten konnten nicht geladen oder gespeichert werden.'
  );
  await expect(dialog.getByRole('alert')).toContainText('Prüfe deine Verbindung');
  await expect(dialog).not.toContainText('upstream unavailable');
});

for (const failure of ['preview', 'persons', 'assignment'] as const) {
  test(`payment ${failure} shows its concrete form error`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: failure === 'preview' ? 'light' : 'dark' });
    const response = await page.request.get('/api/intern/pflege/sammelbestellungen/101');
    const staff = (await response.json()) as SammelStaffView;
    staff.campaign.title = 'A'.repeat(101);
    const order = staff.orders.find((entry) => entry.id === '2003')!;
    const view: SammelPaymentView = {
      campaignArchived: false,
      order,
      record:
        failure === 'preview'
          ? {
              version: 1,
              assignment: {
                person: {
                  id: 'per_Test',
                  name: 'Familie Mayr',
                  emails: [order.email],
                  matchesEmail: true,
                },
                reason: '',
                confirmedBy: { id: 'staff', name: 'Demo' },
                confirmedAt: '2026-10-01T12:00:00Z',
              },
              operation: null,
              dispatch: null,
              settlement: null,
            }
          : null,
      events: [],
      creationEnabled: true,
    };
    const detail =
      failure === 'preview'
        ? 'Der Aktionsname ist als CampFlow-Kostenstelle zu lang (höchstens 100 Zeichen).'
        : failure === 'persons'
          ? 'Mehr als 500 Mitglieder. Bitte die Personenzuordnung mit dem Team abstimmen.'
          : 'Bitte die abweichende Kontaktadresse begründen.';
    const invalid = {
      status: 400,
      json: {
        message: 'Die Eingaben sind unvollständig oder ungültig.',
        fields: failure === 'assignment' ? { reason: detail } : { form: detail },
      },
    };
    await page.route('**/api/intern/pflege/sammelbestellungen/101', (route) =>
      route.fulfill({ json: staff })
    );
    await page.route('**/api/intern/pflege/sammelbestellungen/orders/2003/payment', (route) =>
      route.fulfill(route.request().method() === 'GET' ? { json: view } : invalid)
    );
    await page.route(
      '**/api/intern/pflege/sammelbestellungen/orders/2003/payment/persons',
      (route) =>
        route.fulfill(
          failure === 'assignment'
            ? {
                json: [
                  {
                    id: 'per_Test',
                    name: 'Familie Mayr',
                    emails: [order.email],
                    matchesEmail: true,
                  },
                ],
              }
            : invalid
        )
    );
    await page.goto('/leitendenbereich/sammelbestellungen/101');
    await page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: 'Familie Mayr', exact: true }) })
      .getByRole('button', { name: 'Bezahlung verwalten', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Bezahlung über CampFlow', exact: true });
    if (failure === 'preview')
      await dialog.getByRole('button', { name: 'Beitrag vorbereiten', exact: true }).click();
    if (failure === 'assignment') {
      await expect(dialog.getByLabel('Warum weicht die Kontaktadresse ab?')).toHaveCount(0);
      await dialog.getByRole('checkbox', { name: /Die ausgewählte Person/ }).check();
      await dialog.getByRole('button', { name: 'Person bestätigen', exact: true }).click();
    }
    await expect(dialog.getByRole('alert')).toContainText(detail);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/tmp/278-payment-details-${failure}-${test.info().project.name}.png`,
    });
  });
}
