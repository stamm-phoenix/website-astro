import { test, expect } from './fixtures';

// The mock Aktionen are dated relative to MOCK_NOW (2026-10-01): the Sommerlager and the
// Stammesversammlung are over, so both have an open KJR deadline while they get the grant.

test.afterEach(async ({ page }) => {
  // The mock API keeps the switch per dev server; later tests expect every Aktion with grant
  for (const id of ['evt_Stavo', 'evt_Sola26']) {
    const response = await page.request.put(`/api/intern/pflege/aktionen-zuschuss/${id}`, {
      data: { zuschussfaehig: true },
    });
    expect(response.ok()).toBe(true);
  }
});

test('an Aktion without KJR grant leaves the deadlines and is marked in the lists', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aktionen/aktion?id=evt_Stavo');
  const schalter = page.getByTestId('kjr-zuschuss-schalter');
  const checkbox = schalter.getByRole('checkbox', { name: 'KJR-Zuschuss beantragen' });
  await expect(checkbox).toBeChecked();
  await expect(schalter).toContainText('Steht in den KJR-Fristen.');

  await checkbox.uncheck();
  await expect(schalter).toContainText(
    'Gespeichert: Für „Stammesversammlung“ wird kein KJR-Zuschuss beantragt.'
  );
  await expect(schalter).toContainText('Keine KJR-Frist.');
  await expect(checkbox).not.toBeChecked();

  await page.goto('/leitendenbereich');
  const fristen = page.getByTestId('kjr-fristen');
  await expect(fristen.getByRole('listitem')).toHaveCount(1);
  await expect(fristen).toContainText('Sommerlager 2026 Oberjoch');
  await expect(fristen).not.toContainText('Stammesversammlung');

  await page.goto('/leitendenbereich/aktionen');
  const stavo = page.getByRole('listitem').filter({ hasText: 'Stammesversammlung' });
  await expect(stavo.getByTestId('ohne-kjr-zuschuss')).toHaveText('Ohne KJR-Zuschuss');
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Sommerlager 2026 Oberjoch' })
      .getByTestId('ohne-kjr-zuschuss')
  ).toHaveCount(0);

  await page.goto('/leitendenbereich/abrechnung');
  const row = page.getByRole('listitem').filter({
    has: page.getByRole('link', { name: 'Stammesversammlung', exact: true }),
  });
  await expect(row.getByTestId('ohne-kjr-zuschuss')).toHaveText('Ohne KJR-Zuschuss');
  await expect(row.getByTestId('kjr-frist')).toHaveCount(0);

  // Switched on again in the Abrechnung, the deadline is back
  await row.getByRole('link', { name: 'Stammesversammlung', exact: true }).click();
  await expect(page.getByTestId('kjr-frist')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'KJR-Zuschuss beantragen' }).check();
  await expect(page.getByTestId('kjr-frist')).toContainText('Abgabe beim KJR bis 18.12.2026');
});

test('the Abrechnung of an Aktion without KJR grant shows income and expenses only', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await expect(page.getByRole('heading', { name: 'KJR-Zuschuss', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Teilnahmeliste für den KJR' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'KJR-Zuschuss beantragen' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'KJR-Zuschuss beantragen' })).not.toBeChecked();
  await expect(page.getByTestId('kjr-frist')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'KJR-Zuschuss', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Teilnahmeliste für den KJR' })).toHaveCount(0);
  // The Betreuungsschlüssel is shown, but not assessed
  await expect(page.getByTestId('betreuungsschluessel')).toBeVisible();
  await expect(page.getByTestId('betreuungsschluessel')).not.toHaveClass(/text-warning/);
  const ergebnis = await page.getByTestId('ergebnis').textContent();

  await page.getByRole('tab', { name: /Teilnehmende/ }).click();
  await expect(page.getByRole('columnheader', { name: 'Bezuschusst' })).toHaveCount(0);
  await expect(page.getByTestId('tn-zusammenfassung')).not.toContainText('bezuschusst');
  await expect(page.getByRole('button', { name: 'Zur KJR-Teilnahmeliste' })).toHaveCount(0);

  // Without grant the final result is income − expenses
  await page.getByRole('tab', { name: /Leihgebühren/ }).click();
  await expect(page.getByTestId('leihgebuehren-endergebnis')).toHaveText((ergebnis ?? '').trim());
  await page.getByRole('button', { name: 'Erklärung zu Tage' }).click();
  await expect(page.getByText(/Vorbelegt mit den \d+ Tagen der Aktion/)).toBeVisible();

  // The API refuses the KJR list as well
  const response = await page.request.post('/api/intern/abrechnung/evt_Sola26/kjr-liste', {
    data: { persons: [] },
  });
  expect(response.status()).toBe(409);
});
