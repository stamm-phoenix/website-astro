import { expect } from './fixtures';
import type { Page } from '@playwright/test';
import { emptySession } from '../../api/lib/abrechnung-session';

/** Browser contexts are fresh per test; account drafts in the demo server persist. */
export async function resetAccountingInputs(page: Page): Promise<void> {
  const api = '/api/intern/abrechnung/evt_Sola26/eingaben';
  const current = await (await page.request.get(api)).json();
  const response = await page.request.put(api, {
    data: { session: emptySession(), etag: current.etag },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
