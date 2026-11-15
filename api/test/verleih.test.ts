import * as mail from '../lib/mail';
import { sendVerleihMails } from '../lib/verleih-mail';
import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import { getDb, VersionConflictError } from '../lib/db';
import {
  createInventarArtikel,
  getInventar,
  updateInventarArtikel,
  deleteInventarArtikel,
} from '../lib/inventur';
import { saveVerleih, changeVerleih } from '../lib/verleih-schreiben';
import { getVerleih } from '../lib/verleih-lesen';
import { ValidationError } from '../lib/validation/errors';
import {
  VerleihCollection,
  VerleihEinstellung,
  VerleihItem,
} from '../endpoints/intern-pflege-verleih';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { VerleihInput } from '../lib/verleih-model';
const ANNA = 'anna@stamm-phoenix.de',
  BEN = 'ben@stamm-phoenix.de',
  WART = 'material@stamm-phoenix.de';
async function material() {
  const id = await createInventarArtikel(
    {
      bezeichnung: 'Kohte (Test)',
      kategorie: 'zelt',
      einheit: 'Stück',
      lagerort: 'Keller',
      zustand: 'gut',
      zubehoer: '',
      fehlend: '',
      notizen: '',
      varianten: [{ id: null, bezeichnung: '', bestand: 2 }],
    },
    ANNA
  );
  return (await getInventar()).find((a) => a.id === id)!;
}
function input(varianteId: number): VerleihInput {
  return {
    entleiher: 'Rover',
    kontakt: '',
    verantwortlich: '',
    von: '2027-07-01',
    bis: '2027-07-05',
    notizen: '',
    positionen: [{ varianteId, menge: 2 }],
  };
}
async function version(id: number) {
  return (await getVerleih()).find((a) => a.id === id)!;
}
const action = (aktion: 'rueckgabe' | 'stornieren') => ({ aktion, nachricht: '', rueckgaben: [] });

dbTest(
  'any leader records an immediately active loan without a configured materialwart',
  async () => {
    const a = await material();
    const id = await saveVerleih(input(a.varianten[0].id), ANNA);
    assert.equal((await version(id)).status, 'ausgegeben');
    assert.ok((await version(id)).verlauf.some((v) => v.text === 'Ausleihe eingetragen.'));
  }
);
dbTest('parallel direct entries cannot overbook inventory', async () => {
  const a = await material();
  const results = await Promise.allSettled(
    [ANNA, BEN].map((actor) => saveVerleih(input(a.varianten[0].id), actor))
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await getVerleih()).length, 1);
});
dbTest(
  'another leader can record partial returns; damage blocks new loans and stale versions cannot return twice',
  async () => {
    const a = await material();
    const id = await saveVerleih(input(a.varianten[0].id), ANNA);
    const issued = await version(id);
    const retour = {
      ...action('rueckgabe'),
      rueckgaben: [{ positionId: issued.positionen[0].id, menge: 1, schaden: 'Riss' }],
    };
    await changeVerleih(id, issued.etag, retour, BEN);
    assert.equal((await version(id)).positionen[0].zurueck, 1);
    await assert.rejects(changeVerleih(id, issued.etag, retour, BEN), VersionConflictError);
    await assert.rejects(
      saveVerleih(
        { ...input(a.varianten[0].id), positionen: [{ varianteId: a.varianten[0].id, menge: 1 }] },
        BEN
      ),
      ValidationError
    );
    await changeVerleih(
      id,
      (await version(id)).etag,
      { ...retour, rueckgaben: [{ ...retour.rueckgaben[0], schaden: '' }] },
      BEN
    );
    assert.equal((await version(id)).status, 'abgeschlossen');
    assert.equal((await getInventar()).find((x) => x.id === a.id)?.zustand, 'reparatur');
  }
);
dbTest('stock and deletion remain protected immediately after entering a loan', async () => {
  const a = await material();
  await saveVerleih(input(a.varianten[0].id), ANNA);
  const { varianten, ...fields } = a;
  await assert.rejects(
    updateInventarArtikel(
      a.id,
      { ...fields, varianten: [{ id: varianten[0].id, bezeichnung: '', bestand: 1 }] },
      a.etag,
      ANNA
    ),
    ValidationError
  );
  await assert.rejects(deleteInventarArtikel(a.id, a.etag), ValidationError);
});
dbTest(
  'other leaders can edit and cancel open loans; availability is checked on edits',
  async () => {
    const a = await material();
    const value = input(a.varianten[0].id);
    const id = await saveVerleih(value, ANNA);
    await saveVerleih({ ...value, entleiher: 'Pfadfinder' }, BEN, id, (await version(id)).etag);
    assert.equal((await version(id)).entleiher, 'Pfadfinder');
    await assert.rejects(
      saveVerleih(
        { ...value, positionen: [{ varianteId: a.varianten[0].id, menge: 3 }] },
        BEN,
        id,
        (await version(id)).etag
      ),
      ValidationError
    );
    await changeVerleih(id, (await version(id)).etag, action('stornieren'), BEN);
    assert.equal((await version(id)).status, 'zurueckgezogen');
    await saveVerleih(value, ANNA);
  }
);
dbTest(
  'editing after a partial return preserves returned quantities and position IDs',
  async () => {
    const a = await material();
    const value = input(a.varianten[0].id);
    const id = await saveVerleih(value, ANNA);
    const p = (await version(id)).positionen[0];
    await changeVerleih(
      id,
      (await version(id)).etag,
      { ...action('rueckgabe'), rueckgaben: [{ positionId: p.id, menge: 1, schaden: '' }] },
      BEN
    );
    await saveVerleih(
      { ...value, notizen: 'Verlängert besprochen' },
      BEN,
      id,
      (await version(id)).etag
    );
    assert.equal((await version(id)).positionen[0].id, p.id);
    assert.equal((await version(id)).positionen[0].zurueck, 1);
    await assert.rejects(
      changeVerleih(id, (await version(id)).etag, action('stornieren'), BEN),
      ValidationError
    );
  }
);
dbTest('anonymous users cannot read, write or configure', async () => {
  for (const handler of [VerleihCollection, VerleihEinstellung, VerleihItem])
    assert.equal(
      (
        await handler(
          new HttpRequest({ method: 'GET', url: 'https://example.test/api/intern/pflege/verleih' }),
          new InvocationContext()
        )
      ).status,
      401
    );
});
dbTest('retrying a direct entry cannot duplicate loans or notification jobs', async () => {
  const a = await material();
  const anfrageId = crypto.randomUUID();
  const value = input(a.varianten[0].id);
  const id = await saveVerleih(value, ANNA, undefined, undefined, anfrageId);
  assert.equal(await saveVerleih(value, ANNA, undefined, undefined, anfrageId), id);
  assert.equal((await getVerleih()).length, 1);
  await assert.rejects(
    saveVerleih({ ...value, entleiher: 'Geändert' }, ANNA, undefined, undefined, anfrageId),
    ValidationError
  );
});
dbTest('optional informational mail failure does not undo an active loan', async (t) => {
  await getDb()
    .updateTable('organisation.verleih_einstellung')
    .set({ materialwart: WART })
    .where('id', '=', 1)
    .execute();
  const a = await material();
  const id = await saveVerleih(input(a.varianten[0].id), ANNA);
  let calls = 0;
  const send = t.mock.method(mail, 'sendMail', async () => {
    if (++calls === 2) throw new Error('Graph unavailable');
  });
  assert.equal(await sendVerleihMails(id, 'https://stamm-phoenix.de'), false);
  assert.equal((await version(id)).status, 'ausgegeben');
  send.mock.mockImplementation(async () => undefined);
  assert.equal(await sendVerleihMails(id, 'https://stamm-phoenix.de'), true);
  assert.equal(send.mock.callCount(), 3);
});
