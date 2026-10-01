import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as graph from '../lib/sharepoint-data-access';
import * as env from '../lib/environment';
import * as campflow from '../lib/campflow';
import * as fees from '../lib/campflow-fees';
import * as products from '../lib/sammelbestellung-product';
import { getSammelAutomaticTotal } from '../lib/sammelbestellung-total';
import {
  SammelStaffPayment,
  SammelStaffPaymentPersons,
} from '../endpoints/intern-sammelbestellung-payments';
import { SammelStaffOrder, SammelStaffItem } from '../endpoints/intern-pflege-sammelbestellungen';
import { SammelOrderLookup, SammelOrderSave } from '../endpoints/sammelbestellungen';
import { getSammelOrder, sammelToken } from '../lib/sammelbestellung-list';
import { createSammelContribution, sammelBillingPreview } from '../lib/sammelbestellung-payments';
import { validateSammelPaymentInput } from '../lib/pflege-validation';
import type {
  SammelPaymentView,
  SammelPaymentPreview,
  SammelBillingSnapshot,
  SammelPaymentRecord,
} from '../lib/sammelbestellung-payment-model';
import type { SammelAktion } from '../lib/sammelbestellung-model';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};
const ITEM = { name: 'Kluft', reference: '00123', variant: '164', quantity: 2 };
const FEE = { id: 'fee_One', reference: 'GC12345' };
const createFeeFromApi = fees.createCampflowFee;
const COLUMNS = [
  ...['CampflowZahlung', 'CampflowZahlungsprotokoll'].map((name) => ({
    name,
    text: { allowMultipleLines: true, textType: 'plain', appendChangesToExistingText: false },
  })),
  { name: 'CampflowBeitragId', enforceUniqueValues: true, text: { allowMultipleLines: false } },
];
const PERSONS: campflow.CampflowPerson[] = [
  {
    id: 'per_A',
    name: { first_name: 'Anna', last_name: 'Test' },
    primary_email: 'family@example.test',
    bank_account: { iban: 'PRIVATE' },
    health: ['PRIVATE'],
  },
  {
    id: 'per_B',
    name: { first_name: 'Ben', last_name: 'Test' },
    primary_email: null,
    cc_emails: [' FAMILY@example.test '],
  },
  {
    id: 'per_C',
    name: { first_name: 'Clara', last_name: 'Test' },
    primary_email: 'other@example.test',
  },
  { id: 'per_Old', primary_email: 'family@example.test', leave_date: '2000-01-01' },
  { id: 'per_Future', primary_email: 'family@example.test', join_date: '2099-01-01' },
];

interface Row {
  id: string;
  eTag: string;
  fields: Record<string, unknown>;
}
function setup(t: TestContext) {
  const campaign: Row = {
    id: '1',
    eTag: '"campaign,1"',
    fields: {
      Title: 'Frühjahr',
      Beschreibung: '',
      Beginn: '2020-01-01T00:00:00.000Z',
      Ende: '2099-01-01T00:00:00.000Z',
      Katalog: '[]',
    },
  };
  const order: Row = {
    id: '2',
    eTag: '"order,1"',
    fields: {
      Title: 'Familie Test',
      Email: 'family@example.test',
      AktionId: '1',
      Artikel: JSON.stringify([ITEM]),
      Status: 'Bestellt',
      Eingereicht: true,
      Bezahlt: false,
      Ausgeliefert: false,
      BetragCent: 2400,
    },
  };
  const rows = new Map([['2', order]]);
  let version = 1;
  const calls: SammelBillingSnapshot[] = [];
  t.mock.method(env, 'getEnvironment', (variable: env.EnvironmentVariable) => {
    if (variable === env.EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID)
      return 'campaigns';
    if (variable === env.EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_ORDERS_LIST_ID)
      return 'orders';
    if (variable === env.EnvironmentVariable.SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED)
      return 'true';
    if (variable === env.EnvironmentVariable.SAMMELBESTELLUNG_LINK_SECRET)
      return 'test-secret-with-more-than-thirty-two-characters';
    return 'test';
  });
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected outbound network request');
  });
  t.mock.method(graph, 'getSharePointListColumns', async () => structuredClone(COLUMNS));
  t.mock.method(graph, 'getSharePointListItem', async (list: string, id: string) =>
    structuredClone(list === 'campaigns' ? campaign : rows.get(id))
  );
  t.mock.method(graph, 'getSharePointListItems', async () =>
    [...rows.values()].map((row) => structuredClone(row))
  );
  const write = t.mock.method(
    graph,
    'updateSharePointListItem',
    async (_list: string, id: string, values: Record<string, unknown>, etag?: string) => {
      const row = rows.get(id)!;
      if (!etag || row.eTag !== etag) throw { statusCode: 412 };
      if (
        values.CampflowBeitragId &&
        [...rows.values()].some(
          (other) => other.id !== id && other.fields.CampflowBeitragId === values.CampflowBeitragId
        )
      )
        throw { statusCode: 409 };
      Object.assign(row.fields, structuredClone(values));
      row.eTag = `"order,${++version}"`;
    }
  );
  t.mock.method(campflow, 'campflowGetAll', async () => structuredClone(PERSONS));
  const create = t.mock.method(
    fees,
    'createCampflowFee',
    async (snapshot: SammelBillingSnapshot) => {
      calls.push(snapshot);
      return FEE;
    }
  );
  const context = new InvocationContext({ functionName: 'payment-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  const request = (
    body: unknown,
    method = 'POST',
    principal: unknown = PRINCIPAL,
    id = '2'
  ): HttpRequest =>
    new HttpRequest({
      url: 'https://example.test/api/payment',
      method,
      headers: {
        'content-type': 'application/json',
        ...(principal
          ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
          : {}),
      },
      params: { id },
      body: method === 'GET' ? undefined : { string: JSON.stringify(body) },
    });
  const action = async (body: Record<string, unknown>, id = '2') =>
    SammelStaffPayment(
      request(
        { etag: rows.get(id)!.eTag, confirmed: true, executionEnded: true, ...body },
        'POST',
        PRINCIPAL,
        id
      ),
      context
    );
  const assign = async (personId = 'per_A', reason = '') => {
    const result = await action({ action: 'assign', personId, reason });
    assert.equal(result.status, 200);
    return result.jsonBody as SammelPaymentView;
  };
  const preview = async () => {
    const result = await action({ action: 'preview' });
    assert.equal(result.status, 200);
    return result.jsonBody as SammelPaymentPreview;
  };
  const createFee = async () => {
    await assign();
    const p = await preview();
    return action({ action: 'create', hash: p.hash });
  };
  return {
    campaign,
    order,
    rows,
    calls,
    write,
    create,
    context,
    request,
    action,
    assign,
    preview,
    createFee,
  };
}

test('staff authentication rejects unauthenticated, wrong-provider and foreign-tenant callers before reads', async (t) => {
  const s = setup(t);
  const read = t.mock.method(graph, 'getSharePointListItem', async () => {
    throw new Error('Must not read');
  });
  for (const principal of [
    null,
    { ...PRINCIPAL, identityProvider: 'github' },
    { ...PRINCIPAL, claims: [{ typ: 'tid', val: 'foreign' }] },
  ]) {
    for (const handler of [SammelStaffPayment, SammelStaffPaymentPersons]) {
      const response = await handler(s.request({}, 'GET', principal), s.context);
      assert.ok([401, 403].includes(response.status!));
      assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
    }
  }
  assert.equal(read.mock.callCount(), 0);
});

test('family and CC matches remain distinct selectable people, without sensitive fields or former members', async (t) => {
  const s = setup(t);
  const response = await SammelStaffPaymentPersons(s.request({}, 'GET'), s.context);
  assert.deepEqual(response.jsonBody, [
    { id: 'per_A', name: 'Anna Test', emails: ['family@example.test'], matchesEmail: true },
    { id: 'per_B', name: 'Ben Test', emails: ['family@example.test'], matchesEmail: true },
    { id: 'per_C', name: 'Clara Test', emails: ['other@example.test'], matchesEmail: false },
  ]);
  assert.equal((await s.action({ action: 'assign', personId: 'per_C' })).status, 400);
  assert.equal((await s.action({ action: 'assign', personId: 'per_Old' })).status, 400);
  assert.equal(
    (await s.action({ action: 'assign', personId: 'per_A', confirmed: false })).status,
    400
  );
  await s.assign('per_C', 'Gemeinsame Familienbestellung');
  assert.equal(s.calls.length, 0);
});

test('null contacts and missing names are supported without choosing a first family match', async (t) => {
  const s = setup(t);
  t.mock.method(campflow, 'campflowGetAll', async () => [
    { id: 'per_NoContact', primary_email: null, cc_emails: null },
  ]);
  const result = await SammelStaffPaymentPersons(s.request({}, 'GET'), s.context);
  assert.deepEqual(result.jsonBody, [
    { id: 'per_NoContact', name: 'per_NoContact', emails: [], matchesEmail: false },
  ]);
  assert.equal((await s.action({ action: 'preview' })).status, 409);
});

test('preview uses the stored final cents, not indicative prices, and creation persists ID, reference and actor history', async (t) => {
  const s = setup(t);
  const assigned = await s.assign();
  const preview = await s.preview();
  assert.equal(preview.snapshot.amount, 2400);
  assert.equal(preview.snapshot.personId, 'per_A');
  assert.equal(preview.snapshot.description, 'Sammelbestellung Frühjahr · Bestellung 2');
  assert.deepEqual(preview.snapshot.attachedExpense, {
    costunitName: 'Frühjahr',
    categoryName: 'Bestellungen',
  });
  assert.equal(assigned.record?.assignment.confirmedBy.id, 'staff');
  const result = await s.action({ action: 'create', hash: preview.hash });
  assert.equal(result.status, 200);
  const view = result.jsonBody as SammelPaymentView;
  assert.equal(s.calls.length, 1);
  assert.deepEqual(view.record?.operation?.contribution, FEE);
  assert.deepEqual(
    view.record?.operation?.snapshot.attachedExpense,
    preview.snapshot.attachedExpense
  );
  assert.equal(s.order.fields.CampflowBeitragId, FEE.id);
  assert.deepEqual(
    view.events.map((event) => event.action),
    ['assigned', 'prepared', 'attempted', 'created']
  );
  assert.equal(view.order.payment?.reference, FEE.reference);
  assert.equal(view.record?.dispatch, null);
  assert.equal(view.order.paid, false);
  assert.equal((await s.action({ action: 'create', hash: preview.hash })).status, 200);
  assert.equal(s.calls.length, 1);
});

test('contribution descriptions do not repeat an existing Sammelbestellung prefix', async (t) => {
  const s = setup(t);
  s.campaign.fields.Title = 'Sammelbestellung Test Leitende';
  await s.assign();
  assert.equal(
    (await s.preview()).snapshot.description,
    'Sammelbestellung Test Leitende · Bestellung 2'
  );
});

test('large automatic totals use at most four concurrent lookups and stop queuing after a missing price', async (t) => {
  setup(t);
  const items = Array.from({ length: 40 }, (_, index) => ({
    ...ITEM,
    reference: `https://www.ruesthaus.de/${index + 1}/kluft`,
  }));
  let active = 0,
    peak = 0,
    count = 0;
  let missing = false;
  t.mock.method(products, 'getShopProduct', async () => {
    active++;
    count++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return {
      name: 'Kluft',
      unitPriceCents: missing ? null : 1200,
      imageUrl: null,
      sourceUrl: items[0].reference,
    };
  });
  assert.equal(await getSammelAutomaticTotal(items), 96000);
  assert.ok(peak > 1 && peak <= 4, `Peak concurrency: ${peak}`);
  assert.equal(count, 40);
  count = 0;
  missing = true;
  await assert.rejects(getSammelAutomaticTotal(items));
  assert.ok(count <= 4, `Queued ${count} lookups despite a missing price`);
});

test('ordering without an override adopts the complete active shop total for contribution creation', async (t) => {
  const s = setup(t);
  s.order.fields.BetragCent = null;
  s.order.fields.Status = 'Eingereicht';
  s.order.fields.Artikel = JSON.stringify([
    { ...ITEM, reference: 'https://www.ruesthaus.de/1/kluft' },
    { ...ITEM, excluded: { reason: 'Nicht bestellbar' } },
  ]);
  t.mock.method(products, 'getShopProduct', async () => ({
    name: 'Kluft',
    imageUrl: null,
    unitPriceCents: 1200,
    sourceUrl: 'https://www.ruesthaus.de/1/kluft',
  }));
  const result = await SammelStaffOrder(
    s.request(
      {
        etag: s.order.eTag,
        status: 'Bestellt',
        paid: false,
        delivered: false,
        totalCents: null,
      },
      'PATCH'
    ),
    s.context
  );
  assert.equal(result.status, 204);
  assert.equal(s.order.fields.BetragCent, 2400);
  assert.equal((await s.createFee()).status, 200);
  assert.equal(s.calls[0].amount, 2400);
});

test('an explicit total overrides shop prices and incomplete automatic prices never save a partial total', async (t) => {
  const s = setup(t);
  const lookup = t.mock.method(products, 'getShopProduct', async () => {
    throw new Error('Shop unavailable');
  });
  const save = (totalCents: number | null) =>
    SammelStaffOrder(
      s.request(
        {
          etag: s.order.eTag,
          status: 'Bestellt',
          paid: false,
          delivered: false,
          totalCents,
        },
        'PATCH'
      ),
      s.context
    );
  assert.equal((await save(3100)).status, 204);
  assert.equal(s.order.fields.BetragCent, 3100);
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal((await save(null)).status, 400);
  assert.equal(s.order.fields.BetragCent, 3100);
});

test('creation requires a valid final amount, locked processing status and unchanged preview', async (t) => {
  const s = setup(t);
  await s.assign();
  for (const amount of [null, 0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, 10_000_001]) {
    s.order.fields.BetragCent = amount;
    assert.equal((await s.action({ action: 'preview' })).status, 400);
  }
  s.order.fields.BetragCent = 2400;
  const p = await s.preview();
  s.order.fields.BetragCent = 2500;
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
  s.order.fields.BetragCent = 2400;
  for (const status of ['Eingereicht', 'Storniert']) {
    s.order.fields.Status = status;
    assert.equal((await s.action({ action: 'preview' })).status, 409);
  }
  assert.equal(s.calls.length, 0);
});

test('disabled creation and incomplete storage cannot dispatch a contribution', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const original = env.getEnvironment;
  t.mock.method(env, 'getEnvironment', (name: env.EnvironmentVariable) =>
    name === env.EnvironmentVariable.SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED
      ? 'false'
      : original(name)
  );
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 503);
  t.mock.method(graph, 'getSharePointListColumns', async () =>
    COLUMNS.map((column) => ({ ...column, enforceUniqueValues: false }))
  );
  assert.equal(
    (
      await s.action({
        action: 'adopt',
        hash: p.hash,
        feeId: FEE.id,
        reference: FEE.reference,
        evidence: 'Dashboard geprüft',
      })
    ).status,
    503
  );
  assert.equal(s.calls.length, 0);
});

test('a missing creation gate defaults to disabled, and a missing token does not reserve an operation', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const original = env.getEnvironment;
  t.mock.method(env, 'getEnvironment', (name: env.EnvironmentVariable) => {
    if (name === env.EnvironmentVariable.SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED)
      throw new Error('Missing gate');
    return original(name);
  });
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 503);
  t.mock.method(env, 'getEnvironment', (name: env.EnvironmentVariable) => {
    if (name === env.EnvironmentVariable.CAMPFLOW_API_TOKEN) throw new Error('Missing token');
    return original(name);
  });
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 503);
  assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation, null);
  assert.equal(s.calls.length, 0);
});

test('archived and paid orders do not create new contributions; former selected members are rejected', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  s.campaign.fields.Archiviert = true;
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
  s.campaign.fields.Archiviert = false;
  s.order.fields.Bezahlt = true;
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
  s.order.fields.Bezahlt = false;
  t.mock.method(campflow, 'campflowGetAll', async () => []);
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 400);
  assert.equal(s.calls.length, 0);
});

test('two concurrent staff creations reserve at most one external write', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const body = { action: 'create', confirmed: true, etag: s.order.eTag, hash: p.hash };
  const results = await Promise.all([
    SammelStaffPayment(s.request(body), s.context),
    SammelStaffPayment(s.request(body), s.context),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(s.calls.length, 1);
});

test('timeout after remote creation leaves a locked uncertain record and never resends', async (t) => {
  const s = setup(t);
  t.mock.method(fees, 'createCampflowFee', async (snapshot: SammelBillingSnapshot) => {
    s.calls.push(snapshot);
    throw new fees.CampflowFeeUncertainError('timeout');
  });
  assert.equal((await s.createFee()).status, 502);
  const current = (await getSammelOrder('2'))!;
  assert.equal(current.paymentRecord?.operation?.state, 'uncertain');
  const p = await s.preview();
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
  assert.equal(s.calls.length, 1);
  s.campaign.fields.Archiviert = true;
  const adopted = await s.action({
    action: 'adopt',
    hash: p.hash,
    feeId: FEE.id,
    reference: FEE.reference,
    evidence:
      'CampFlow-Support hat Person, Betrag und Bestellnummer geprüft. Alter Versuch beendet.',
  });
  assert.equal(adopted.status, 200);
  assert.equal(s.calls.length, 1);
});

test('an ambiguous dispatch reservation never sends, even when persisted as attempted', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const original = graph.updateSharePointListItem;
  t.mock.method(
    graph,
    'updateSharePointListItem',
    async (list: string, id: string, values: Record<string, unknown>, etag?: string) => {
      await original(list, id, values, etag);
      if (String(values.CampflowZahlung).includes('"state":"attempted"'))
        throw new Error('Lost reservation response');
    }
  );
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 502);
  assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation?.state, 'attempted');
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
  assert.equal(s.calls.length, 0);
});

test('a crash after preparation can resume only through another concrete ETag reservation', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const original = graph.updateSharePointListItem;
  t.mock.method(
    graph,
    'updateSharePointListItem',
    async (list: string, id: string, values: Record<string, unknown>, etag?: string) => {
      if (String(values.CampflowZahlung).includes('"state":"attempted"'))
        throw new Error('Crash before reservation');
      await original(list, id, values, etag);
    }
  );
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 502);
  assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation?.state, 'prepared');
  assert.equal(s.calls.length, 0);
  t.mock.method(graph, 'updateSharePointListItem', original);
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 200);
  assert.equal(s.calls.length, 1);
});

test('legacy prepared contributions retain their original payload without a new accounting assignment', async (t) => {
  const s = setup(t);
  await s.assign();
  const preview = await s.preview();
  // Stop before the attempted reservation; the prepared record is safe to resume.
  const write = graph.updateSharePointListItem;
  const probe = t.mock.method(
    graph,
    'updateSharePointListItem',
    async (list: string, id: string, values: Record<string, unknown>, etag?: string) => {
      if (String(values.CampflowZahlung).includes('"state":"attempted"'))
        throw new Error('Stopped');
      return write(list, id, values, etag);
    }
  );
  await s.action({ action: 'create', hash: preview.hash });
  const current = JSON.parse(String(s.order.fields.CampflowZahlung)) as SammelPaymentRecord;
  assert.equal(current.operation!.state, 'prepared');
  delete current.operation!.snapshot.attachedExpense;
  current.operation!.hash = createHash('sha256')
    .update(JSON.stringify(current.operation!.snapshot))
    .digest('hex');
  s.order.fields.CampflowZahlung = JSON.stringify(current);
  probe.mock.restore();
  assert.equal((await s.action({ action: 'create', hash: current.operation!.hash })).status, 200);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].attachedExpense, undefined);
});

test('local result persistence retries conflicts without repeating the provider POST', async (t) => {
  const s = setup(t);
  const original = graph.updateSharePointListItem;
  let conflict = true;
  t.mock.method(
    graph,
    'updateSharePointListItem',
    async (list: string, id: string, values: Record<string, unknown>, etag?: string) => {
      if (conflict && String(values.CampflowZahlung).includes('"state":"created"')) {
        conflict = false;
        s.order.eTag = '"external,1"';
        s.order.fields.Bemerkungen = 'Unrelated note';
        throw { statusCode: 412 };
      }
      await original(list, id, values, etag);
    }
  );
  assert.equal((await s.createFee()).status, 200);
  assert.equal(s.calls.length, 1);
  assert.equal(s.order.fields.Bemerkungen, 'Unrelated note');
});

test('remote success followed by unavailable local persistence remains blocked across reloads', async (t) => {
  const s = setup(t);
  const original = graph.updateSharePointListItem;
  t.mock.method(
    graph,
    'updateSharePointListItem',
    async (list: string, id: string, values: Record<string, unknown>, etag?: string) => {
      if (/"state":"(?:created|uncertain)"/.test(String(values.CampflowZahlung)))
        throw new Error('SharePoint unavailable');
      await original(list, id, values, etag);
    }
  );
  assert.equal((await s.createFee()).status, 502);
  assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation?.state, 'attempted');
  const p = await s.preview();
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
  assert.equal(s.calls.length, 1);
});

test('member edits, amount changes, reopening, cancellations and article changes respect an active contribution lock', async (t) => {
  const s = setup(t);
  assert.equal((await s.createFee()).status, 200);
  const status = { status: 'Bestellt', paid: false, delivered: false, totalCents: 2400 };
  for (const change of [{ totalCents: 2500 }, { status: 'Eingereicht' }, { status: 'Storniert' }]) {
    const result = await SammelStaffOrder(
      s.request({ etag: s.order.eTag, ...status, ...change }, 'PATCH'),
      s.context
    );
    assert.equal(result.status, 400);
  }
  assert.equal(
    (
      await SammelStaffItem(
        s.request({ etag: s.order.eTag, index: 0, excluded: true }, 'PATCH'),
        s.context
      )
    ).status,
    400
  );
  const member = {
    id: '2',
    token: sammelToken('order', '2'),
    etag: s.order.eTag,
    name: 'Changed',
    notes: '',
    items: [ITEM],
  };
  assert.equal((await SammelOrderSave(s.request(member, 'POST', null), s.context)).status, 403);
  const lookup = await SammelOrderLookup(s.request(member, 'POST', null), s.context);
  const json = JSON.stringify(lookup.jsonBody);
  assert.ok(!json.includes('confirmedBy'));
  assert.ok(!json.includes('operationKey'));
  assert.ok(!json.includes('staff@example.test'));
  assert.equal((lookup.jsonBody as { canEdit: boolean }).canEdit, false);
  assert.equal(
    (
      await SammelStaffOrder(
        s.request(
          { etag: s.order.eTag, ...status, status: 'Eingetroffen', delivered: true },
          'PATCH'
        ),
        s.context
      )
    ).status,
    204
  );
});

test('manual payment marking is audited, leaves delivery independent and dispatch requires evidence', async (t) => {
  const s = setup(t);
  await s.createFee();
  assert.equal((await s.action({ action: 'dispatched', evidence: '' })).status, 400);
  const dispatched = await s.action({
    action: 'dispatched',
    evidence: 'Am 1. Oktober im Dashboard an family@example.test verschickt',
  });
  assert.equal(dispatched.status, 200);
  assert.equal((await s.action({ action: 'dispatched', evidence: 'Again' })).status, 409);
  const result = await SammelStaffOrder(
    s.request(
      { etag: s.order.eTag, status: 'Bestellt', paid: true, delivered: false, totalCents: 2400 },
      'PATCH'
    ),
    s.context
  );
  assert.equal(result.status, 204);
  const current = (await getSammelOrder('2'))!;
  assert.equal(current.paymentRecord?.settlement?.source, 'manual');
  assert.equal(current.paymentRecord?.settlement?.actor.id, 'staff');
  assert.equal(current.delivered, false);
  assert.equal(s.calls.length, 1);
});

test('manual adoption requires completed-execution confirmation and a unique contribution ID', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const body = {
    action: 'adopt',
    hash: p.hash,
    feeId: FEE.id,
    reference: FEE.reference,
    evidence: 'Person und Betrag im Dashboard geprüft',
  };
  assert.equal((await s.action({ ...body, executionEnded: false })).status, 400);
  s.rows.set('3', {
    ...structuredClone(s.order),
    id: '3',
    fields: { ...structuredClone(s.order.fields), CampflowBeitragId: FEE.id },
  });
  assert.equal((await s.action(body)).status, 409);
  assert.equal(s.calls.length, 0);
  s.rows.delete('3');
  assert.equal((await s.action(body)).status, 200);
  assert.equal(s.calls.length, 0);
});

test('legacy records remain manual; corrupt and future payment JSON fail closed', async (t) => {
  const s = setup(t);
  const legacy = await SammelStaffPayment(s.request({}, 'GET'), s.context);
  assert.equal((legacy.jsonBody as SammelPaymentView).record, null);
  assert.equal((legacy.jsonBody as SammelPaymentView).order.payment, undefined);
  for (const value of ['{', '{}', 'null', '{"version":2}']) {
    s.order.fields.CampflowZahlung = value;
    assert.equal((await SammelStaffPayment(s.request({}, 'GET'), s.context)).status, 503);
  }
  delete s.order.fields.CampflowZahlung;
  s.order.fields.CampflowBeitragId = FEE.id;
  assert.equal((await SammelStaffPayment(s.request({}, 'GET'), s.context)).status, 503);
});

test('payment input validation rejects wildcard versions, forged IDs and unconfirmed actions', () => {
  for (const body of [
    { action: 'assign', etag: '*', personId: 'per_A', confirmed: true },
    { action: 'assign', etag: '"1"', personId: 'not-a-person', confirmed: true },
    { action: 'create', etag: '"1"', hash: 'a'.repeat(64), confirmed: false },
  ])
    assert.throws(() => validateSammelPaymentInput(body));
  assert.equal(
    validateSammelPaymentInput({ action: 'preview', etag: 'W/"version"' }).etag,
    'W/"version"'
  );
});

test('a stale preview version cannot reserve or dispatch a fee', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const stale = s.order.eTag;
  s.order.eTag = '"changed,1"';
  const result = await SammelStaffPayment(
    s.request({ action: 'create', etag: stale, hash: p.hash, confirmed: true }),
    s.context
  );
  assert.equal(result.status, 409);
  assert.equal(s.calls.length, 0);
});

test('an uncertain contribution blocks payment marking and person reassignment', async (t) => {
  const s = setup(t);
  t.mock.method(fees, 'createCampflowFee', async () => {
    throw new fees.CampflowFeeUncertainError('timeout');
  });
  await s.createFee();
  assert.equal((await s.action({ action: 'assign', personId: 'per_B' })).status, 409);
  const result = await SammelStaffOrder(
    s.request(
      { etag: s.order.eTag, status: 'Bestellt', paid: true, delivered: false, totalCents: 2400 },
      'PATCH'
    ),
    s.context
  );
  assert.equal(result.status, 400);
  assert.equal((await s.action({ action: 'dispatched', evidence: 'Unverified' })).status, 409);
});

test('full audit history blocks financial dispatch and malformed nonblank history is rejected', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const event = JSON.parse(String(s.order.fields.CampflowZahlungsprotokoll))[0];
  s.order.fields.CampflowZahlungsprotokoll = JSON.stringify(
    Array.from({ length: 97 }, () => event)
  );
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 503);
  assert.equal(s.calls.length, 0);
  s.order.fields.CampflowZahlungsprotokoll = '{';
  assert.equal((await SammelStaffPayment(s.request({}, 'GET'), s.context)).status, 503);
});

test('incorrect payment column types fail before any state mutation', async (t) => {
  const s = setup(t);
  t.mock.method(graph, 'getSharePointListColumns', async () =>
    COLUMNS.map((column) =>
      column.name === 'CampflowZahlung'
        ? {
            ...column,
            text: {
              allowMultipleLines: true,
              textType: 'richText',
              appendChangesToExistingText: false,
            },
          }
        : column
    )
  );
  assert.equal((await s.action({ action: 'assign', personId: 'per_A' })).status, 503);
  assert.equal(s.write.mock.callCount(), 0);
  assert.equal(s.calls.length, 0);
});

test('full payment history reports an actionable error without changing the payment flag', async (t) => {
  const s = setup(t);
  await s.createFee();
  const event = JSON.parse(String(s.order.fields.CampflowZahlungsprotokoll))[0];
  s.order.fields.CampflowZahlungsprotokoll = JSON.stringify(
    Array.from({ length: 100 }, () => event)
  );
  const result = await SammelStaffOrder(
    s.request(
      { etag: s.order.eTag, status: 'Bestellt', paid: true, delivered: false, totalCents: 2400 },
      'PATCH'
    ),
    s.context
  );
  assert.equal(result.status, 503);
  assert.equal((result.jsonBody as { code: string }).code, 'PAYMENT_AUDIT_FULL');
  assert.equal(s.order.fields.Bezahlt, false);
});

test('the provider adapter sends one documented array payload and validates a complete 201 response', async (t) => {
  setup(t);
  const snapshot: SammelBillingSnapshot = {
    personId: 'per_A',
    amount: 2400,
    description: 'Bestellung 2',
    orderId: '2',
    campaignId: '1',
    revision: 'a'.repeat(64),
    attachedExpense: { costunitName: 'Frühjahr', categoryName: 'Bestellungen' },
  };
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    count++;
    assert.equal(url, 'https://api.campflow.de/fees');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init.body)), {
      data: [
        {
          person_id: 'per_A',
          amount: 2400,
          description: 'Bestellung 2',
          attached_expense: { costunit_name: 'Frühjahr', category_name: 'Bestellungen' },
        },
      ],
    });
    return new Response(
      JSON.stringify({
        data: [{ ...FEE, amount: 2400, description: 'Bestellung 2', person_id: 'per_A' }],
      }),
      { status: 201 }
    );
  });
  assert.deepEqual(await createFeeFromApi(snapshot), FEE);
  assert.equal(count, 1);
});

test('the provider adapter never retries errors, malformed success or mismatched financial data', async (t) => {
  setup(t);
  const snapshot: SammelBillingSnapshot = {
    personId: 'per_A',
    amount: 2400,
    description: 'Bestellung 2',
    orderId: '2',
    campaignId: '1',
    revision: 'a'.repeat(64),
  };
  const valid = { ...FEE, amount: 2400, description: 'Bestellung 2', person_id: 'per_A' };
  for (const response of [
    new Response('', { status: 403 }),
    new Response('', { status: 422 }),
    new Response('', { status: 429 }),
    new Response('', { status: 500 }),
    new Response('not JSON', { status: 201 }),
    new Response(JSON.stringify({ data: [] }), { status: 201 }),
    new Response(JSON.stringify({ data: [valid, valid] }), { status: 201 }),
    new Response(JSON.stringify({ data: [{ ...valid, amount: 1 }] }), { status: 201 }),
    new Response(JSON.stringify({ data: [{ ...valid, person_id: 'per_Other' }] }), { status: 201 }),
  ]) {
    let count = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      count++;
      return response;
    });
    await assert.rejects(createFeeFromApi(snapshot), fees.CampflowFeeUncertainError);
    assert.equal(count, 1);
  }
});

test('crash recovery keeps the operation payload immutable even for prepared records', async (t) => {
  const s = setup(t);
  await s.assign();
  const p = await s.preview();
  const original = graph.updateSharePointListItem;
  t.mock.method(
    graph,
    'updateSharePointListItem',
    async (list: string, id: string, values: Record<string, unknown>, etag?: string) => {
      if (String(values.CampflowZahlung).includes('"state":"attempted"')) throw new Error('Crash');
      await original(list, id, values, etag);
    }
  );
  await s.action({ action: 'create', hash: p.hash });
  const current = (await getSammelOrder('2'))!;
  const campaign: SammelAktion = {
    id: '1',
    etag: '"1"',
    title: 'Frühjahr',
    description: '',
    startsAt: '2020-01-01',
    endsAt: '2099-01-01',
    catalog: [],
    archived: false,
  };
  current.items = [{ ...ITEM, quantity: 3 }];
  const changed = sammelBillingPreview(current, campaign);
  await assert.rejects(createSammelContribution(current, campaign, changed.hash, PRINCIPAL));
  assert.equal(s.calls.length, 0);
});
