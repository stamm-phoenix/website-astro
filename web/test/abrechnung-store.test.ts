import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { abrechnungKey, abrechnungStore, fetchAbrechnung } from '../src/lib/abrechnungStore.svelte';
import type { Abrechnung } from '../src/lib/types';
import { gate, json, stubFetch } from './fixtures/fetch-stub';

/** Reloads of the Abrechnung overview (`fetchAbrechnung`) must never join an older request. */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

function abrechnung(titel: string): Abrechnung {
  return { title: titel } as unknown as Abrechnung;
}

function titel(key: string): string | undefined {
  return (abrechnungStore.data[key] as unknown as { title?: string } | undefined)?.title;
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
    assert.notEqual(erstes, zweites);
    await zweites;
    assert.equal(stub.calls.length, 2);
    assert.equal(titel(key), 'neu');

    alt.open();
    await erstes;
    assert.equal(titel(key), 'neu');
    assert.equal(abrechnungStore.loading[key], undefined);
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
  assert.equal(erstes, zweites);
  offen.open();
  await erstes;
  assert.equal(stub.calls.length, 1);
});
