import type { Page } from '@playwright/test';
import type { StaffProtokoll, StaffProtokolleData } from '../src/lib/types';
import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.beforeEach(async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' });
});

const initialOverrides = new WeakMap<Page, Map<string, Partial<StaffProtokoll>>>();

/** Change only the initial display state; writes still use the actual mock endpoint. */
async function initialItem(
  page: Page,
  id: string,
  values: Partial<StaffProtokoll>,
  terminConfigured = true
): Promise<void> {
  const existing = initialOverrides.get(page);
  if (existing) {
    existing.set(id, values);
    return;
  }
  const overrides = new Map([[id, values]]);
  initialOverrides.set(page, overrides);
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const match = new URL(request.url()).pathname.match(/\/protokolle\/([^/]+)\/termin$/);
    if (match) overrides.delete(match[1]);
  });
  await page.route('**/api/intern/pflege/protokolle', async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as StaffProtokolleData;
    data.terminConfigured = terminConfigured;
    for (const [itemId, fields] of overrides) {
      const item = data.items.find((item) => item.id === itemId);
      if (!item) throw new Error(`Missing mock protocol ${itemId}`);
      Object.assign(item, fields);
    }
    await route.fulfill({ response, json: data });
  });
}

test('recognition consumes the backend response envelope and reports success', async ({ page }) => {
  await initialItem(page, 'prot-7', { termin: null, terminStale: false });
  await page.goto('/leitendenbereich/protokolle');
  const block = page.locator('#protokoll-prot-7');
  await block.getByRole('button', { name: 'Termin erkennen', exact: true }).click();
  await expect(
    page.getByText(/Termin in „Leitendenrunde Sommerlager“ erkannt\. Bitte prüfen/).first()
  ).toBeVisible();
  await expect(block.getByText('Vorschlag:', { exact: false })).toBeVisible();
  await expect(
    block.getByRole('button', { name: /Bestätigen.*nächste Leitendenrunde/ })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a stale confirmed archive can be read again and its decision is reset', async ({ page }) => {
  await initialItem(page, 'prot-4', {
    terminStale: true,
    termin: {
      sourceVersion: 'older-version',
      extraction: 'gefunden',
      suggestion: { date: '2026-11-04', time: null, place: null, quote: 'Nächste LR am 4.11.' },
      decision: 'bestaetigt',
      confirmed: { date: '2026-11-04', time: null, place: null },
      decidedBy: 'reviewer@example.test',
      decidedAt: '2026-10-01T12:00:00Z',
      extractedAt: '2026-10-01T12:00:00Z',
    },
  });
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: /^Erledigt/ }).click();
  const block = page.locator('#protokoll-prot-4');
  await expect(block.getByText(/älteren Fassung/)).toBeVisible();
  await expect(block.getByRole('button', { name: /Ändern/ })).toHaveCount(0);
  await block.getByRole('button', { name: 'Erneut erkennen', exact: true }).click();
  await expect(
    page.getByText(/Termin in „Protokoll LR“ erkannt\. Bitte prüfen/).first()
  ).toBeVisible();
  await expect(block.getByText(/älteren Fassung/)).toHaveCount(0);
  await expect(
    block.getByRole('button', { name: /Bestätigen.*nächste Leitendenrunde/ })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('manual archive entry works before recognition and needs no model call', async ({ page }) => {
  await initialItem(page, 'prot-4', { termin: null, terminStale: false });
  const actions: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/prot-4/termin') && request.method() === 'POST') {
      actions.push(request.postDataJSON().action);
    }
  });
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: /^Erledigt/ }).click();
  const block = page.locator('#protokoll-prot-4');
  await block.getByRole('button', { name: 'Termin eintragen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Datum', { exact: true }).fill('2026-11-05');
  await dialog.getByLabel(/Uhrzeit/).fill('18:00');
  await dialog.getByLabel(/Ort/).fill('online');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(block.getByText(/5\. November 2026, 18:00 Uhr, online/)).toBeVisible();
  expect(actions).toEqual(['bestaetigen']);
  await expectNoHorizontalOverflow(page);
});

test('sent minutes edited after approval expose no date decision or recognition actions', async ({
  page,
}) => {
  await initialItem(page, 'prot-3', { changedSinceApproval: true, terminStale: true });
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: /^Erledigt/ }).click();
  const block = page.locator('#protokoll-prot-3 section[aria-labelledby^="protokoll-termin-"]');
  await expect(block.getByText(/Datei wurde nach dem Versand geändert/)).toBeVisible();
  await expect(block.getByRole('button')).toHaveCount(0);
});

test('a reviewer can correct a suggestion and reject an unresolved date', async ({ page }) => {
  await initialItem(page, 'prot-5', {
    terminStale: false,
    termin: {
      sourceVersion: 'mock-1',
      extraction: 'unklar',
      suggestion: {
        date: '2026-11-04',
        time: '19:30',
        place: 'Pfarrheim',
        quote: 'Nächste LR am 4.11.',
      },
      decision: 'offen',
      confirmed: null,
      decidedBy: '',
      decidedAt: '',
      extractedAt: '2026-10-01T12:00:00Z',
    },
  });
  await initialItem(page, 'prot-6', { termin: null, terminStale: false });
  await page.goto('/leitendenbereich/protokolle');
  const block = page.locator('#protokoll-prot-5');
  await block.getByRole('button', { name: /Bestätigen.*nächste Leitendenrunde/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Datum', { exact: true })).toHaveValue('2026-11-04');
  await expect(dialog.getByLabel(/Uhrzeit/)).toHaveValue('19:30');
  await dialog.getByLabel('Datum', { exact: true }).fill('2026-11-06');
  await dialog.getByRole('button', { name: 'Bestätigen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(block.getByText(/6\. November 2026, 19:30 Uhr, Pfarrheim/)).toBeVisible();
  const unresolved = page.locator('#protokoll-prot-6');
  await unresolved.getByRole('button', { name: 'Kein Termin', exact: true }).click();
  await expect(
    unresolved.getByText('Kein nächster Termin eingetragen.', { exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('an unclear quote without a date remains visible for manual correction', async ({ page }) => {
  const quote = 'Die nächste Leitendenrunde ist Anfang November; wir stimmen den Tag noch ab.';
  await initialItem(page, 'prot-6', {
    terminStale: false,
    termin: {
      sourceVersion: 'mock-1',
      extraction: 'unklar',
      suggestion: { date: null, time: null, place: null, quote },
      decision: 'offen',
      confirmed: null,
      decidedBy: '',
      decidedAt: '',
      extractedAt: '2026-10-01T12:00:00Z',
    },
  });
  await page.goto('/leitendenbereich/protokolle');
  const block = page.locator('#protokoll-prot-6');
  await expect(block.locator('blockquote')).toHaveText(quote);
  await block.getByRole('button', { name: /Bestätigen.*nächste Leitendenrunde/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('blockquote')).toHaveText(quote);
  await expect(dialog.getByLabel('Datum', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Datum', { exact: true }).fill('2026-11-07');
  await dialog.getByRole('button', { name: 'Bestätigen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(block.getByText(/7\. November 2026/)).toBeVisible();
});

test('a rejected suggestion can be recognized again without a file change', async ({ page }) => {
  await page.goto('/leitendenbereich/protokolle');
  const block = page.locator('#protokoll-prot-7');
  await block.getByRole('button', { name: 'Kein Termin', exact: true }).click();
  await expect(block.getByText('Kein nächster Termin eingetragen.', { exact: true })).toBeVisible();
  await block.getByRole('button', { name: 'Erneut erkennen', exact: true }).click();
  await expect(block.getByText('Vorschlag:', { exact: false })).toBeVisible();
  await expect(block.getByText('Kein nächster Termin eingetragen.', { exact: true })).toHaveCount(0);
  await expect(block.getByRole('button', { name: /Bestätigen.*nächste Leitendenrunde/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const configured of [true, false]) {
  test(`previously unconfigured recognition follows the current deployment: ${configured}`, async ({
    page,
  }) => {
    await initialItem(
      page,
      'prot-6',
      {
        terminStale: false,
        termin: {
          sourceVersion: 'mock-1',
          extraction: 'nicht eingerichtet',
          suggestion: { date: null, time: null, place: null, quote: null },
          decision: 'offen',
          confirmed: null,
          decidedBy: '',
          decidedAt: '',
          extractedAt: '2026-10-01T12:00:00Z',
        },
      },
      configured
    );
    await page.goto('/leitendenbereich/protokolle');
    const block = page.locator('#protokoll-prot-6');
    await expect(block.getByRole('button', { name: 'Termin eintragen', exact: true })).toBeVisible();
    const retry = block.getByRole('button', { name: 'Erneut erkennen', exact: true });
    if (configured) {
      await retry.click();
      await expect(block.getByText('Vorschlag:', { exact: false })).toBeVisible();
    } else {
      await expect(retry).toHaveCount(0);
      await expect(block.getByText(/automatische Auswertung ist nicht eingerichtet/)).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });
}
