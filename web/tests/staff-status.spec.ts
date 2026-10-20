import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import type { SammelPaymentView, SammelStaffView } from '../src/lib/types';

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' });
});

test('an uncertain CampFlow result is the same visible warning in the order and payment dialog', async ({
  page,
}) => {
  const response = await page.request.get('/api/intern/pflege/sammelbestellungen/101');
  const staff = (await response.json()) as SammelStaffView;
  const order = staff.orders.find((entry) => entry.id === '2003')!;
  order.payment = {
    state: 'uncertain',
    locked: true,
    reference: 'TEST-REF',
    requestSentAt: null,
    paymentMarkedAt: null,
  };
  const view: SammelPaymentView = {
    campaignArchived: false,
    creationEnabled: true,
    order,
    events: [],
    record: {
      version: 1,
      assignment: {
        person: { id: 'per_Test', name: order.name, emails: [order.email], matchesEmail: true },
        reason: '',
        confirmedBy: { id: 'staff', name: 'Demo' },
        confirmedAt: '2026-10-01T12:00:00Z',
      },
      operation: {
        key: 'test',
        hash: 'test',
        state: 'uncertain',
        startedAt: '2026-10-01T12:00:00Z',
        attemptedAt: '2026-10-01T12:00:00Z',
        errorCategory: null,
        contribution: { id: 'fee_Test', reference: 'TEST-REF' },
        snapshot: {
          personId: 'per_Test',
          amount: order.totalCents!,
          description: 'Test',
          orderId: order.id,
          campaignId: order.campaignId,
          revision: 'test',
        },
      },
      dispatch: null,
      settlement: null,
    },
  };
  await page.route('**/api/intern/pflege/sammelbestellungen/101', (route) =>
    route.fulfill({ json: staff })
  );
  await page.route('**/api/intern/pflege/sammelbestellungen/orders/2003/payment', (route) =>
    route.fulfill({ json: view })
  );
  await page.goto('/leitendenbereich/sammelbestellungen/101');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: order.name, exact: true }) });
  const label = 'Ergebnis unklar. Bitte in CampFlow prüfen.';
  await expect(card.getByText(label, { exact: true })).toHaveAttribute('data-tone', 'warning');
  await expect(card).toContainText('TEST-REF');
  await card.getByRole('button', { name: 'Bezahlung verwalten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Bezahlung über CampFlow' });
  await expect(dialog.getByText(label, { exact: true })).toHaveAttribute('data-tone', 'warning');
  await expect(dialog).toContainText(/Erst in CampFlow prüfen, ob ein Beitrag entstanden ist/);
  await dialog.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('payment-warning.png') });
  await expectNoHorizontalOverflow(page);
});
