import type { HttpResponseInit } from '@azure/functions';
import { toNikolausConfig } from '../lib/nikolaus-config';
import { getNikolausSettings } from '../lib/nikolaus-settings';
import { withErrorHandling } from '../lib/response-utils';

/**
 * GET: the public settings of the Nikolausdienst (days, times, switch of the online booking,
 * service area). Baked into the public pages and refreshed in the browser.
 */
export async function GetNikolausSettingsEndpoint(): Promise<HttpResponseInit> {
  return {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=60' },
    jsonBody: toNikolausConfig(await getNikolausSettings()),
  };
}

export default withErrorHandling(GetNikolausSettingsEndpoint);
