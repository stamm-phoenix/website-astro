import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type {
  KonversationZeile,
  PostfachAnsicht,
  PostfachPerson,
} from '../../api/lib/postfach-model';
import {
  ladeNachKonflikt,
  ladePersonen,
  ladePostfach,
  neuLaden,
  postfachListe,
  setzeStatus,
  setzeZustaendig,
  setzeZustaendigMehrere,
} from '../src/lib/postfachStore.svelte';
import { gate, json, stubFetch, type StubbedCall } from './fixtures/fetch-stub';

/** Late and out-of-order answers of the module „E-Mail“ (`postfachStore.svelte.ts`). */

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => stub?.restore());

function zeile(id: string, extra: Partial<KonversationZeile> = {}): KonversationZeile {
  return {
    id,
    postfach: 'x',
    betreff: id,
    von: { name: 'Erika', adresse: 'erika@example.invalid' },
    am: '2026-11-03T10:00:00.000Z',
    vorschau: '',
    anzahl: 1,
    hatAnhang: false,
    wichtig: false,
    zustaendig: null,
    status: 'neu',
    ...extra,
  };
}

function liste(postfach: string, zeilen: KonversationZeile[]): PostfachAnsicht {
  return {
    postfach: {
      id: postfach,
      name: postfach,
      address: `${postfach}@example.invalid`,
      outlookUrl: '',
    },
    konversationen: zeilen,
    begrenzt: false,
    ich: 'ich@example.invalid',
  };
}

const TOM = { login: 'tom@example.invalid', name: 'Tom Test' };

function zeileIn(id: string): KonversationZeile | undefined {
  return postfachListe.state.data?.konversationen.find((entry) => entry.id === id);
}

test('a reload asked before an assignment does not bring the old line back', async () => {
  const altesLaden = gate();
  stub = stubFetch(async ({ method, path }) => {
    if (method === 'PUT')
      return json({ zustaendig: TOM, status: 'handlungsbedarf', benachrichtigt: true });
    if (path.endsWith('?frisch=1')) {
      await altesLaden.promise;
      return json(liste('a1', [zeile('k1')]));
    }
    return json(liste('a1', [zeile('k1')]));
  });
  await ladePostfach('a1');
  // The reload read the state before the assignment; its answer arrives after the assignment
  const nachladen = neuLaden('a1');
  await setzeZustaendig('a1', 'k1', TOM.login, null);
  assert.equal(zeileIn('k1')?.zustaendig?.name, 'Tom Test');
  altesLaden.open();
  await nachladen;
  assert.equal(zeileIn('k1')?.zustaendig?.name, 'Tom Test');
  assert.equal(zeileIn('k1')?.status, 'handlungsbedarf');
});

test('a reload that was not overtaken replaces the list', async () => {
  stub = stubFetch(({ path }) =>
    json(liste('a2', path.endsWith('?frisch=1') ? [zeile('neu')] : [zeile('alt')]))
  );
  await ladePostfach('a2');
  assert.equal(zeileIn('alt')?.id, 'alt');
  await neuLaden('a2');
  assert.deepEqual(
    postfachListe.state.data?.konversationen.map((entry) => entry.id),
    ['neu']
  );
});

test('a late status answer of a mailbox that was left keeps the new mailbox on screen', async () => {
  const spaeteAntwort = gate();
  const neueListe = gate();
  stub = stubFetch(async ({ method, path }) => {
    if (method === 'PUT') {
      await spaeteAntwort.promise;
      return json({ status: 'erledigt' });
    }
    if (path === '/intern/postfach/b3') {
      await neueListe.promise;
      return json(liste('b3', []));
    }
    return json(liste('a3', [zeile('k1')]));
  });
  await ladePostfach('a3');
  const speichern = setzeStatus('a3', 'k1', 'erledigt', 'neu', '2026-11-03T10:00:00.000Z');
  // The other mailbox is opened, its list is still on its way when the late answer arrives
  const neu = ladePostfach('b3');
  spaeteAntwort.open();
  await speichern;
  neueListe.open();
  await neu;
  assert.equal(postfachListe.state.data?.postfach.id, 'b3');
  assert.deepEqual(postfachListe.state.data?.konversationen, []);
});

test('a late status answer of a mailbox that was left does not change a line of the new one', async () => {
  const spaeteAntwort = gate();
  stub = stubFetch(async ({ method, path }) => {
    if (method === 'PUT') {
      await spaeteAntwort.promise;
      return json({ status: 'erledigt' });
    }
    return json(liste(path.split('/').pop() ?? '', [zeile('k1')]));
  });
  await ladePostfach('a4');
  const speichern = setzeStatus('a4', 'k1', 'erledigt', 'neu', '2026-11-03T10:00:00.000Z');
  await ladePostfach('b4');
  spaeteAntwort.open();
  await speichern;
  assert.equal(postfachListe.state.data?.postfach.id, 'b4');
  assert.equal(zeileIn('k1')?.status, 'neu');
});

test('a late „Erledigt“ does not close a conversation that got a newer message meanwhile', async () => {
  const spaeteAntwort = gate();
  const gesehen = '2026-11-03T10:00:00.000Z';
  stub = stubFetch(async ({ method, path }) => {
    if (method === 'PUT') {
      await spaeteAntwort.promise;
      return json({ status: 'erledigt' });
    }
    const am = path.endsWith('?frisch=1') ? '2026-11-03T10:01:00.000Z' : gesehen;
    return json(liste('a5', [zeile('k1', { am })]));
  });
  await ladePostfach('a5');
  const speichern = setzeStatus('a5', 'k1', 'erledigt', 'neu', gesehen);
  await neuLaden('a5');
  spaeteAntwort.open();
  await speichern;
  // The mark covers only the older messages
  assert.equal(zeileIn('k1')?.status, 'neu');
});

test('a conversation closed without a newer message stays done', async () => {
  const gesehen = '2026-11-03T10:00:00.000Z';
  stub = stubFetch(({ method, path }) =>
    method === 'PUT'
      ? json({ status: 'erledigt' })
      : json(liste(path.split('/').pop() ?? '', [zeile('k1', { am: gesehen })]))
  );
  await ladePostfach('a6');
  await setzeStatus('a6', 'k1', 'erledigt', 'neu', gesehen);
  assert.equal(zeileIn('k1')?.status, 'erledigt');
});

test('a conflict of a mailbox that was left does not load its list again', async () => {
  stub = stubFetch(({ path }) => json(liste(path.split('/').pop() ?? '', [])));
  await ladePostfach('a7');
  await ladePostfach('b7');
  const vorher = stub.calls.length;
  await ladeNachKonflikt('a7');
  assert.equal(stub.calls.length, vorher);
  assert.equal(postfachListe.state.data?.postfach.id, 'b7');
  await ladeNachKonflikt('b7');
  assert.equal(stub.calls.length, vorher + 1);
});

test('a later change of the same conversation overtakes the answer of an earlier one', async () => {
  const erste = gate();
  let puts = 0;
  stub = stubFetch(async ({ method, path }) => {
    if (method === 'PUT') {
      if (++puts === 1) await erste.promise;
      return json({ status: puts === 1 ? 'erledigt' : 'neu' });
    }
    return json(liste(path.split('/').pop() ?? '', [zeile('k1')]));
  });
  await ladePostfach('a8');
  const frueh = setzeStatus('a8', 'k1', 'erledigt', 'neu', '2026-11-03T10:00:00.000Z');
  await setzeStatus('a8', 'k1', 'neu', 'neu', '2026-11-03T10:00:00.000Z');
  erste.open();
  assert.equal((await frueh).ueberholt, true);
});

test('after „Neu laden“ the choice of people follows the team', async () => {
  let team: PostfachPerson[] = [TOM];
  stub = stubFetch(({ path }) =>
    path.endsWith('/personen') ? json({ personen: team }) : json(liste('a9', [zeile('k1')]))
  );
  await ladePostfach('a9');
  assert.deepEqual(await ladePersonen('a9'), [TOM]);
  // Tom left the team, Nina joined: the list of people is kept for a while ...
  const nina = { login: 'nina@example.invalid', name: 'Nina Neu' };
  team = [nina];
  assert.deepEqual(await ladePersonen('a9'), [TOM]);
  // ... and read again after „Neu laden“
  await neuLaden('a9');
  assert.deepEqual(await ladePersonen('a9'), [nina]);
});

test('a refused assignment makes the next choice read the people again', async () => {
  let team: PostfachPerson[] = [TOM];
  stub = stubFetch(({ method, path }) => {
    if (method === 'PUT')
      return json({ error: 'CONFLICT', code: 'CONFLICT', message: 'Weg.' }, 409);
    return path.endsWith('/personen')
      ? json({ personen: team })
      : json(liste('a10', [zeile('k1')]));
  });
  await ladePostfach('a10');
  await ladePersonen('a10');
  team = [];
  await assert.rejects(setzeZustaendig('a10', 'k1', TOM.login, null));
  assert.deepEqual(await ladePersonen('a10'), []);
});

test('more than 100 chosen conversations are handed on in parts and answered together', async () => {
  const zeilen = Array.from({ length: 150 }, (_, index) => zeile(`v${index}`));
  const teile: number[] = [];
  stub = stubFetch(({ method, path, body }: StubbedCall) => {
    if (method !== 'PUT') return json(liste('a11', zeilen));
    assert.ok(path.endsWith('/zustaendig-mehrere'));
    const teil = (body as { konversationen: { konversation: string }[] }).konversationen;
    teile.push(teil.length);
    return json({
      ergebnisse: teil.map(({ konversation }) => ({
        konversation,
        ok: true,
        zustaendig: TOM,
        status: 'handlungsbedarf',
      })),
      // The note of the second part failed
      benachrichtigt: teile.length === 1,
    });
  });
  await ladePostfach('a11');
  const antwort = await setzeZustaendigMehrere('a11', TOM.login, zeilen);
  assert.deepEqual(teile, [100, 50]);
  assert.equal(antwort.ergebnisse.length, 150);
  assert.equal(antwort.benachrichtigt, false);
  assert.equal(zeileIn('v149')?.zustaendig?.name, 'Tom Test');
  assert.equal(zeileIn('v0')?.status, 'handlungsbedarf');
});

test('a late reload of a mailbox that was left keeps the new mailbox on screen', async () => {
  const spaeteAntwort = gate();
  stub = stubFetch(async ({ path }) => {
    if (path.endsWith('?frisch=1')) {
      await spaeteAntwort.promise;
      return json(liste('a12', [zeile('k1')]));
    }
    return json(liste(path.split('/').pop() ?? '', []));
  });
  await ladePostfach('a12');
  const nachladen = neuLaden('a12');
  await ladePostfach('b12');
  spaeteAntwort.open();
  await nachladen;
  assert.equal(postfachListe.state.data?.postfach.id, 'b12');
});
