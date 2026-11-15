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
async function setup() {
  await getDb()
    .updateTable('organisation.verleih_einstellung')
    .set({ materialwart: WART })
    .where('id', '=', 1)
    .execute();
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
const action = (
  aktion: 'genehmigen' | 'ablehnen' | 'ausgeben' | 'rueckgabe' | 'zurueckziehen'
) => ({ aktion, nachricht: '', rueckgaben: [] });

dbTest('only the materialwart decides; parallel approvals never overbook', async () => {
  await setup();
  const a = await material();
  const one = await saveVerleih(input(a.varianten[0].id), ANNA);
  const two = await saveVerleih(input(a.varianten[0].id), ANNA);
  await assert.rejects(
    changeVerleih(one, (await version(one)).etag, action('genehmigen'), ANNA),
    ValidationError
  );
  const results = await Promise.allSettled(
    [one, two].map(async (id) =>
      changeVerleih(id, (await version(id)).etag, action('genehmigen'), WART)
    )
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await getVerleih()).filter((v) => [one, two].includes(v.id) && v.status === 'genehmigt')
      .length,
    1
  );
});
dbTest(
  'partial returns keep open quantities; damage blocks further lending; stale versions cannot return twice',
  async () => {
    await setup();
    const a = await material();
    const id = await saveVerleih(input(a.varianten[0].id), ANNA);
    await changeVerleih(id, (await version(id)).etag, action('genehmigen'), WART);
    await changeVerleih(id, (await version(id)).etag, action('ausgeben'), WART);
    const issued = await version(id);
    const retour = {
      ...action('rueckgabe'),
      rueckgaben: [{ positionId: issued.positionen[0].id, menge: 1, schaden: 'Riss' }],
    };
    await changeVerleih(id, issued.etag, retour, WART);
    assert.equal((await version(id)).positionen[0].zurueck, 1);
    assert.equal((await version(id)).status, 'ausgegeben');
    await assert.rejects(changeVerleih(id, issued.etag, retour, WART), VersionConflictError);
    const next = await saveVerleih(
      { ...input(a.varianten[0].id), positionen: [{ varianteId: a.varianten[0].id, menge: 1 }] },
      ANNA
    );
    await assert.rejects(
      changeVerleih(next, (await version(next)).etag, action('genehmigen'), WART),
      ValidationError
    );
    await changeVerleih(
      id,
      (await version(id)).etag,
      { ...retour, rueckgaben: [{ ...retour.rueckgaben[0], schaden: '' }] },
      WART
    );
    assert.equal((await version(id)).status, 'abgeschlossen');
    assert.equal((await getInventar()).find((x) => x.id === a.id)?.zustand, 'reparatur');
    assert.ok((await version(id)).verlauf.some((v) => v.text.includes('Riss')));
  }
);
dbTest(
  'inventory stock and variant deletion cannot invalidate approved reservations or history',
  async () => {
    await setup();
    const a = await material();
    const id = await saveVerleih(input(a.varianten[0].id), ANNA);
    await changeVerleih(id, (await version(id)).etag, action('genehmigen'), WART);
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
  }
);
dbTest('a request can be edited or withdrawn only by its author before a decision', async () => {
  await setup();
  const a = await material();
  const value = input(a.varianten[0].id);
  const id = await saveVerleih(value, ANNA);
  await assert.rejects(
    saveVerleih({ ...value, entleiher: 'Fremd' }, WART, id, (await version(id)).etag),
    ValidationError
  );
  await saveVerleih({ ...value, entleiher: 'Pfadfinder' }, ANNA, id, (await version(id)).etag);
  assert.equal((await version(id)).entleiher, 'Pfadfinder');
  await changeVerleih(id, (await version(id)).etag, action('zurueckziehen'), ANNA);
  await assert.rejects(
    changeVerleih(id, (await version(id)).etag, action('genehmigen'), WART),
    ValidationError
  );
});
dbTest('unconfigured materialwart does not save requests without a recipient', async () => {
  await getDb()
    .updateTable('organisation.verleih_einstellung')
    .set({ materialwart: '' })
    .where('id', '=', 1)
    .execute();
  const a = await material();
  const before = (await getVerleih()).length;
  await assert.rejects(saveVerleih(input(a.varianten[0].id), ANNA), ValidationError);
  assert.equal((await getVerleih()).length, before);
});
dbTest('anonymous users cannot read, decide or configure', async () => {
  for (const handler of [VerleihCollection, VerleihEinstellung, VerleihItem]) {
    const result = await handler(
      new HttpRequest({ method: 'GET', url: 'https://example.test/api/intern/pflege/verleih' }),
      new InvocationContext()
    );
    assert.equal(result.status, 401);
  }
});

dbTest(
  'retrying an accepted request does not duplicate requests or notification jobs',
  async () => {
    await setup();
    const a = await material();
    const anfrageId = crypto.randomUUID();
    const id = await saveVerleih(input(a.varianten[0].id), ANNA, undefined, undefined, anfrageId);
    const count = await getDb()
      .selectFrom('organisation.verleih_mail')
      .selectAll()
      .where('verleih_id', '=', id)
      .execute();
    assert.equal(
      await saveVerleih(input(a.varianten[0].id), ANNA, undefined, undefined, anfrageId),
      id
    );
    assert.equal(
      (
        await getDb()
          .selectFrom('organisation.verleih_mail')
          .selectAll()
          .where('verleih_id', '=', id)
          .execute()
      ).length,
      count.length
    );
    await assert.rejects(
      saveVerleih(
        { ...input(a.varianten[0].id), entleiher: 'Geändert' },
        ANNA,
        undefined,
        undefined,
        anfrageId
      ),
      ValidationError
    );
  }
);

dbTest(
  'failed mail delivery keeps the request and retries only recipients still unsent',
  async (t) => {
    await setup();
    const a = await material();
    const id = await saveVerleih(input(a.varianten[0].id), ANNA);
    let calls = 0;
    const send = t.mock.method(mail, 'sendMail', async () => {
      calls++;
      if (calls === 2) throw new Error('Graph unavailable');
    });
    assert.equal(await sendVerleihMails(id, 'https://stamm-phoenix.de'), false);
    assert.equal((await version(id)).status, 'antrag');
    assert.equal((await version(id)).mailOffen, 1);
    send.mock.mockImplementation(async () => undefined);
    assert.equal(await sendVerleihMails(id, 'https://stamm-phoenix.de'), true);
    assert.equal(send.mock.callCount(), 3);
    assert.equal((await version(id)).mailOffen, 0);
    assert.equal(await sendVerleihMails(id, 'https://stamm-phoenix.de'), true);
    assert.equal(send.mock.callCount(), 3);
  }
);

dbTest(
  'approved material can be cancelled before issue; elapsed requests cannot be approved',
  async () => {
    await setup();
    const a = await material();
    const value = input(a.varianten[0].id);
    const id = await saveVerleih(value, ANNA);
    await changeVerleih(id, (await version(id)).etag, action('genehmigen'), WART);
    await changeVerleih(
      id,
      (await version(id)).etag,
      { ...action('genehmigen'), aktion: 'stornieren' },
      WART
    );
    assert.equal((await version(id)).status, 'zurueckgezogen');
    const past = await saveVerleih({ ...value, von: '2020-01-01', bis: '2020-01-02' }, ANNA);
    await assert.rejects(
      changeVerleih(past, (await version(past)).etag, action('genehmigen'), WART),
      ValidationError
    );
  }
);
