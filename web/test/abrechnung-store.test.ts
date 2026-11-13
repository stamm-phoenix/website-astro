import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  abrechnungKey,
  abrechnungStore,
  fetchAbrechnung,
  forgetAbrechnungen,
  kostenstellenStore,
} from '../src/lib/abrechnungStore.svelte';
import type { Abrechnung } from '../src/lib/types/abrechnung';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** Reloads of the Abrechnung overview (`fetchAbrechnung`) must never join an older request. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

function abrechnung(titel: string): Abrechnung {
  return { title: titel } as unknown as Abrechnung;
}

function titel(key: string): string | undefined {
  return (abrechnungStore[key]?.data as unknown as { title?: string } | undefined)?.title;
}

for (const option of ['force', 'refresh'] as const) {
  test(`${option} starts its own request and a late older answer does not overwrite it`, async () => {
    const id = `ev-${option}`;
    const key = abrechnungKey(id);
    const alt = gate();
    stub = stubFetch(async ({ path }) => {
      if (path.includes('refresh=true')) return json(abrechnung('neu'));
      if (calls() === 1) {
        await alt.promise;
        return json(abrechnung('alt'));
      }
      return json(abrechnung('neu'));
    });
    const calls = (): number => stub?.calls.length ?? 0;

    const erstes = fetchAbrechnung(id);
    const zweites = fetchAbrechnung(id, '', { [option]: true });
    await zweites;
    assert.equal(stub.calls.length, 2);
    assert.equal(titel(key), 'neu');

    alt.open();
    await erstes;
    assert.equal(titel(key), 'neu');
    assert.equal(abrechnungStore[key]?.loading, false);
  });
}

test('a plain call still joins the running request', async () => {
  const id = 'ev-join';
  const offen = gate();
  stub = stubFetch(async () => {
    await offen.promise;
    return json(abrechnung('x'));
  });
  const erstes = fetchAbrechnung(id);
  const zweites = fetchAbrechnung(id);
  offen.open();
  await Promise.all([erstes, zweites]);
  assert.equal(stub.calls.length, 1);
});

test('a cached Abrechnung is not asked for again, another Kostenstelle is its own entry', async () => {
  const id = 'ev-cache';
  stub = stubFetch(async ({ path }) => json(abrechnung(path)));
  await fetchAbrechnung(id);
  await fetchAbrechnung(id);
  assert.equal(stub.calls.length, 1);
  await fetchAbrechnung(id, 'K 1');
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[1].path, `/intern/abrechnung/${id}?kostenstelle=K%201`);
  assert.equal(titel(abrechnungKey(id)), `/intern/abrechnung/${id}`);
  assert.equal(titel(abrechnungKey(id, 'K 1')), `/intern/abrechnung/${id}?kostenstelle=K%201`);
});

test('refresh asks for a new export with both query parameters and keeps the cache key', async () => {
  const id = 'ev-refresh-url';
  stub = stubFetch(async () => json(abrechnung('x')));
  await fetchAbrechnung(id, 'K 1', { refresh: true });
  assert.equal(stub.calls[0].path, `/intern/abrechnung/${id}?kostenstelle=K%201&refresh=true`);
  await fetchAbrechnung(id, 'K 1');
  assert.equal(stub.calls.length, 1);
});

test('forgetAbrechnungen drops what was loaded, so the next visit asks again', async () => {
  const id = 'ev-forget';
  stub = stubFetch(async () => json(abrechnung('x')));
  await fetchAbrechnung(id);
  forgetAbrechnungen();
  assert.equal(abrechnungStore[abrechnungKey(id)], undefined);
  await fetchAbrechnung(id);
  assert.equal(stub.calls.length, 2);
});

test('a missing Kostenstelle shows its message and loads the Kostenstellen to pick from', async () => {
  const id = 'ev-ks-missing';
  stub = stubFetch(async ({ path }) => {
    if (path === '/intern/kostenstellen') return json([{ id: 'K 1' }]);
    return json({ code: 'KOSTENSTELLE_NOT_FOUND', message: 'Keine Kostenstelle gefunden.' }, 404);
  });
  await fetchAbrechnung(id);
  const state = abrechnungStore[abrechnungKey(id)];
  assert.equal(state.errorCode, 'KOSTENSTELLE_NOT_FOUND');
  assert.equal(state.error, 'Keine Kostenstelle gefunden.');
  assert.equal(state.loading, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stub.calls.at(-1)?.path, '/intern/kostenstellen');
  assert.deepEqual(kostenstellenStore.data, [{ id: 'K 1' }]);
});
