import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import * as endpoints from '../../endpoints/essensplanung';
import { essenMail } from '../../lib/essen-mails';
import type { PlanungAnsicht } from '../../lib/essen-planung-model';
import { solvedAltcha, useAltcha } from './altcha';

/** Calling the public endpoints of the Essensplanung and creating a Planung for a test. */

export type Endpoint = (
  request: HttpRequest,
  context: InvocationContext
) => Promise<HttpResponseInit>;

export interface Optionen {
  token?: string;
  body?: unknown;
  params?: Record<string, string>;
  ifMatch?: string;
  query?: string;
}

export function context(t: TestContext): InvocationContext {
  const result = new InvocationContext();
  t.mock.method(result, 'log', () => undefined);
  t.mock.method(result, 'error', () => undefined);
  return result;
}

export function call(
  t: TestContext,
  endpoint: Endpoint,
  method: string,
  path: string,
  { token, body, params, ifMatch, query = '' }: Optionen = {}
): Promise<HttpResponseInit> {
  return endpoint(
    new HttpRequest({
      url: `https://www.stamm-phoenix.de/api/essensplanung/${path}${query}`,
      method,
      headers: {
        ...(token ? { 'x-essensplanung-token': token } : {}),
        ...(ifMatch ? { 'if-match': ifMatch } : {}),
      },
      params,
      body: body === undefined ? undefined : { string: JSON.stringify(body) },
    }),
    context(t)
  );
}

export function json<T = Record<string, unknown>>(response: HttpResponseInit): T {
  return response.jsonBody as T;
}

export interface GesendeteMail {
  to: string;
  subject: string;
  html: string;
}

export function captureMails(t: TestContext): GesendeteMail[] {
  const mails: GesendeteMail[] = [];
  t.mock.method(essenMail, 'send', async (to: string, subject: string, html: string) => {
    mails.push({ to, subject, html });
  });
  return mails;
}

/** The token of the first link with `#<param>=` in a mail. */
export function tokenAus(mail: GesendeteMail, param: string): string {
  const match = new RegExp(`#${param}=([A-Za-z0-9_-]{43})`).exec(mail.html);
  assert.ok(match, `no #${param}= link in the mail`);
  return match[1];
}

let naechste = 0;
export let BESITZERIN = { email: 'kueche@stamm-phoenix.de', name: 'Kim Küche' };

/** A new owner address per Planung, so the limit of requests per address never interferes. */
export function neueBesitzerin(): void {
  BESITZERIN = { email: `kueche${++naechste}@stamm-phoenix.de`, name: 'Kim Küche' };
}

/** Creates and confirms a Planung of three days; returns the owner's token and the view. */
export async function anlegen(
  t: TestContext,
  mails: GesendeteMail[]
): Promise<{ token: string; ansicht: PlanungAnsicht }> {
  useAltcha(t);
  neueBesitzerin();
  const angelegt = await call(t, endpoints.EssensplanungAnlegen, 'POST', 'anlegen', {
    body: {
      ...BESITZERIN,
      planungName: 'Sommerlager',
      ersterTag: '2027-08-01',
      letzterTag: '2027-08-03',
      altcha: await solvedAltcha(),
    },
  });
  assert.equal(angelegt.status, 200, JSON.stringify(angelegt.jsonBody));
  const mail = mails.at(-1)!;
  assert.equal(mail.to, BESITZERIN.email);
  const bestaetigt = await call(
    t,
    endpoints.EssensplanungBestaetigen,
    'POST',
    'anlegen/bestaetigen',
    {
      body: { token: tokenAus(mail, 'a') },
    }
  );
  assert.equal(bestaetigt.status, 201);
  const token = json<{ token: string }>(bestaetigt).token;
  const ansicht = json<PlanungAnsicht>(
    await call(t, endpoints.EssensplanungPlanung, 'GET', 'planung', { token })
  );
  return { token, ansicht };
}
