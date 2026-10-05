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
  await expect(dialog.getByText(/wirtschaftlichen Geschäftsbetrieb/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: test.info().outputPath('payment-review.png') });
  await dialog.getByRole('button', { name: 'Beitrag anlegen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Bestätigung ankreuzen/);
  expect(actions).toEqual(['preview']);
  const confirmation = dialog.getByRole('checkbox', { name: /Person und endgültiger Betrag/ });
  await confirmation.check();
  page.once('dialog', (prompt) => prompt.dismiss());
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
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
