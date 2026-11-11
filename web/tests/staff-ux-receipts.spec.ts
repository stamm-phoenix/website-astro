import { test, expect } from './fixtures';
import type { BelegStatus, StaffBeleg } from '../src/lib/types';

// A receipt opens to look at; a decision on stored details that do not pass opens the field to
// correct, or, once accepted, says what is missing
for (const scenario of [
  { action: 'Ablehnen', status: 'Eingereicht', field: 'Bemerkung der Kasse', stored: {} },
  { action: 'Annehmen', status: 'Eingereicht', field: 'Datum des Belegs', stored: { date: '' } },
  { action: 'Erneut einreichen', status: 'Abgelehnt', field: 'Geschäft', stored: { shop: '' } },
  {
    action: 'Nach CampFlow übertragen',
    status: 'Angenommen',
    field: null,
    stored: { kostenstelle: '', kategorie: '' },
  },
] satisfies {
  action: string;
  status: BelegStatus;
  field: string | null;
  stored: Partial<StaffBeleg>;
}[]) {
  test(`receipt action ${scenario.action} announces and focuses its invalid field`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const records = (await (
      await page.request.get('/api/intern/pflege/belege')
    ).json()) as StaffBeleg[];
    const receipt: StaffBeleg = {
      ...records[0],
      art: 'Ausgabe',
      shop: 'UX-Prüfung',
      date: '2026-09-15',
      amountCent: 1234,
      paidBy: 'Demo Leitung',
      payout: true,
      aktion: '',
      kostenstelle: 'Allgemein',
      kategorie: 'Material',
      status: scenario.status,
      reviewNote: scenario.status === 'Abgelehnt' ? 'Unscharf' : '',
      campflow: null,
      readOnly: undefined,
      editable: scenario.status !== 'Angenommen',
      ...scenario.stored,
    };
    await page.route('**/api/intern/pflege/belege', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: [receipt] }) : route.continue()
    );
    await page.goto('/leitendenbereich/belege');
    await page
      .getByRole('list', { name: 'Belege' })
      .getByRole('button', { name: /^(UX-Prüfung|Ohne Geschäft)/ })
      .click();
    const dialog = page.getByRole('dialog');
    const action = dialog.getByRole('button', { name: scenario.action, exact: true });
    if (!scenario.field) {
      // Accepted, it can no longer be changed: the transfer waits, and says how to go on
      await expect(action).toBeDisabled();
      await expect(dialog.getByText(/Nimm die Annahme zurück, um sie zu ergänzen/)).toBeVisible();
      return;
    }
    await action.click();
    const field = dialog.getByLabel(scenario.field, { exact: true });
    await expect(dialog.getByRole('alert')).toHaveText('Bitte prüfe das markierte Feld.');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  });
}

for (const source of [
  {
    name: 'CampFlow',
    route: '**/api/intern/pflege/belege/campflow*',
    error: 'Die Belege aus CampFlow konnten nicht geladen werden.',
    retry: 'Belege aus CampFlow erneut laden',
  },
  {
    name: 'website',
    route: '**/api/intern/pflege/belege',
    error: 'Die hier eingereichten Belege konnten nicht geladen werden.',
    retry: 'Hier eingereichte Belege erneut laden',
  },
]) {
  test(`an unexplained ${source.name} load failure offers a usable receipt retry`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let fail = true;
    await page.route(source.route, (route) =>
      fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue()
    );
    await page.goto('/leitendenbereich/belege');
    const error = page.getByRole('alert').filter({ hasText: source.error });
    await expect(error).toBeVisible();
    await expect(error).not.toContainText('„Erneut versuchen“');
    await expect(
      page.getByRole('list', { name: 'Belege' }).getByRole('listitem').first()
    ).toBeVisible();
    fail = false;
    await error.getByRole('button', { name: source.retry, exact: true }).click();
    await expect(error).toBeHidden();
  });
}

test('when both receipt sources fail the general load error still offers its retry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route('**/api/intern/pflege/belege**', (route) =>
    fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue()
  );
  await page.goto('/leitendenbereich/belege');
  const error = page
    .getByRole('alert')
    .filter({ hasText: 'Die hier eingereichten Belege konnten nicht geladen werden.' });
  await expect(error).toBeVisible();
  await expect(error).not.toContainText('„Erneut versuchen“');
  fail = false;
  await error.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(error).toBeHidden();
  await expect(
    page.getByRole('list', { name: 'Belege' }).getByRole('listitem').first()
  ).toBeVisible();
});
