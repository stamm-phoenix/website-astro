import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest } from '@azure/functions';
import { EssensplanungZutatenSammel } from '../endpoints/intern-essensplanung-zutaten';
import { listZutaten } from '../lib/essen-steuerung';
import { dbTest } from './fixtures/database';
import { context } from './fixtures/essensplanung';

/** „Alle übernehmen“ of the central list saves each entry on its own. */

function sammel(t: TestContext, zutaten: unknown, rollen = ['team_admin']) {
  return EssensplanungZutatenSammel(
    new HttpRequest({
      url: 'http://localhost/api/intern/pflege/essensplanung-zutaten/sammel',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ms-client-principal': Buffer.from(
          JSON.stringify({
            identityProvider: 'aad',
            userId: 'admin',
            userDetails: 'admin@example.test',
            userRoles: ['authenticated', 'team_leitende', ...rollen],
          })
        ).toString('base64'),
      },
      body: { string: JSON.stringify({ zutaten }) },
    }),
    context(t)
  );
}

dbTest('saves each proposal on its own and names the ones that failed', async (t) => {
  const [erste, zweite] = await listZutaten();
  const eintrag = (zutat: typeof erste, patch: object) => ({
    ...zutat,
    hinweis: zutat.hinweis,
    ...patch,
  });
  const antwort = await sammel(t, [
    eintrag(erste, { vegetarisch: true, vegan: false, lebensmittel: true }),
    eintrag(zweite, { etag: 'AAAAAAAAB9E=', hinweis: 'veraltet' }),
  ]);
  assert.equal(antwort.status, 200, JSON.stringify(antwort.jsonBody));
  const { ergebnisse } = antwort.jsonBody as {
    ergebnisse: { id: number; fehler: string | null }[];
  };
  assert.deepEqual(ergebnisse, [
    { id: erste.id, fehler: null },
    { id: zweite.id, fehler: 'Jemand hat die Zutat inzwischen geändert. Prüf sie noch einmal.' },
  ]);
  const nachher = await listZutaten();
  assert.equal(nachher.find((z) => z.id === erste.id)?.vegetarisch, true);
  assert.equal(nachher.find((z) => z.id === zweite.id)?.hinweis, zweite.hinweis);

  assert.equal((await sammel(t, [])).status, 400);
  assert.equal((await sammel(t, [eintrag(erste, {})], [])).status, 403);
});
