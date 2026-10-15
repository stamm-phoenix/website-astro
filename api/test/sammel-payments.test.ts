import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { Insertable, KyselyPlugin, Updateable } from 'kysely';
import * as db from '../lib/db';
import { getDb } from '../lib/db';
import * as env from '../lib/environment';
import * as campflow from '../lib/campflow';
import * as fees from '../lib/campflow-fees';
import * as playwright from '../lib/playwright-api';
import * as products from '../lib/sammelbestellung-product';
import * as list from '../lib/sammelbestellung-list';
import { dbTest } from './fixtures/database';
import {
  SAMMEL_ITEM as ITEM,
  changeCampaign,
  changeOrder,
  loadOrder,
  orderVersion,
  sammelCampaign,
  sammelOrder,
  seedSammel,
} from './fixtures/sammel';
import {
  SammelStaffPayment,
  SammelStaffPaymentPersons,
} from '../endpoints/intern-sammelbestellung-payments';
import { SammelStaffOrder, SammelStaffItem } from '../endpoints/intern-pflege-sammelbestellungen';
import { SammelOrderLookup, SammelOrderSave } from '../endpoints/sammelbestellungen';
import { getSammelCampaign, getSammelOrder, sammelToken } from '../lib/sammelbestellung-list';
import type { SammelOrderChanges } from '../lib/sammelbestellung-list';
import type { SammelPaymentTable } from '../lib/db-schema';
import { createSammelContribution, sammelBillingPreview } from '../lib/sammelbestellung-payments';
import { validateSammelPaymentInput } from '../lib/pflege-validation';
import type {
  SammelPaymentView,
  SammelPaymentPreview,
  SammelBillingSnapshot,
  SammelPaymentOperation,
} from '../lib/sammelbestellung-payment-model';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};
const FEE = { id: 'fee_One', reference: 'GC12345' };
const createFeeFromApi = fees.createCampflowFee;
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

/** Lets a write of the given payment state fail, before or after it reached the database. */
function failWrite(
  t: TestContext,
  matches: (state: SammelPaymentOperation['state'] | undefined) => boolean,
  { after = false, error = new Error('Lost database response') } = {}
) {
  const original = list.updateSammelOrder;
  return t.mock.method(
    list,
    'updateSammelOrder',
    async (id: string, changes: SammelOrderChanges, etag: string) => {
      const hit = changes.payment && matches(changes.payment.record.operation?.state);
      if (hit && !after) throw error;
      await original(id, changes, etag);
      if (hit) throw error;
    }
  );
}

/** Order 2 of campaign 1, ordered with a final amount of 24 €. */
async function setup(t: TestContext, { secondOrder = false } = {}) {
  const order = { status: 'Bestellt', totalCents: 2400 } as const;
  await seedSammel(
    [sammelCampaign({ description: '' })],
    [
      sammelOrder(order),
      ...(secondOrder ? [sammelOrder({ ...order, id: '3', email: 'other@example.test' })] : []),
    ]
  );
  const calls: SammelBillingSnapshot[] = [];
  t.mock.method(env, 'getEnvironment', (variable: env.EnvironmentVariable) => {
    if (variable === env.EnvironmentVariable.SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED)
      return 'true';
    if (variable === env.EnvironmentVariable.SAMMELBESTELLUNG_LINK_SECRET)
      return 'test-secret-with-more-than-thirty-two-characters';
    return 'test';
  });
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected outbound network request');
  });
  t.mock.method(campflow, 'campflowGetAll', async () => structuredClone(PERSONS));
  const mapping = t.mock.method(
    playwright,
    'ensureCampflowExpenseAssignment',
    async () => undefined
  );
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
        { etag: await orderVersion(id), confirmed: true, executionEnded: true, ...body },
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
  const status = async (values: Record<string, unknown>) =>
    SammelStaffOrder(
      request(
        {
          etag: await orderVersion(),
          status: 'Bestellt',
          paid: false,
          delivered: false,
          totalCents: 2400,
          ...values,
        },
        'PATCH'
      ),
      context
    );
  return { mapping, calls, create, context, request, action, assign, preview, createFee, status };
}

test('staff authentication rejects unauthenticated, wrong-provider and foreign-tenant callers before reads', async (t) => {
  const context = new InvocationContext({ functionName: 'payment-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(db, 'getDb', () => {
    throw new Error('Must not read');
  });
  for (const principal of [
    null,
    { ...PRINCIPAL, identityProvider: 'github' },
    { ...PRINCIPAL, claims: [{ typ: 'tid', val: 'foreign' }] },
  ]) {
    for (const handler of [SammelStaffPayment, SammelStaffPaymentPersons]) {
      const response = await handler(
        new HttpRequest({
          url: 'https://example.test/api/payment',
          method: 'GET',
          headers: principal
            ? {
                'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
              }
            : {},
          params: { id: '2' },
        }),
        context
      );
      assert.ok([401, 403].includes(response.status!));
      assert.equal(new Headers(response.headers).get('cache-control'), 'no-store');
    }
  }
});

dbTest(
  'family and CC matches remain distinct selectable people, without sensitive fields or former members',
  async (t) => {
    const s = await setup(t);
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
    const view = await s.assign('per_C', 'Gemeinsame Familienbestellung');
    assert.deepEqual(view.record?.assignment.person, {
      id: 'per_C',
      name: 'Clara Test',
      emails: ['other@example.test'],
      matchesEmail: false,
    });
    assert.deepEqual(
      await getDb().selectFrom('sammel.payment_email').select(['position', 'email']).execute(),
      [{ position: 0, email: 'other@example.test' }]
    );
    assert.equal(s.calls.length, 0);
  }
);

dbTest(
  'null contacts and missing names are supported without choosing a first family match',
  async (t) => {
    const s = await setup(t);
    t.mock.method(campflow, 'campflowGetAll', async () => [
      { id: 'per_NoContact', primary_email: null, cc_emails: null },
    ]);
    const result = await SammelStaffPaymentPersons(s.request({}, 'GET'), s.context);
    assert.deepEqual(result.jsonBody, [
      { id: 'per_NoContact', name: 'per_NoContact', emails: [], matchesEmail: false },
    ]);
    assert.equal((await s.action({ action: 'preview' })).status, 409);
    await s.assign('per_NoContact', 'Keine Adresse in CampFlow');
    assert.deepEqual((await loadOrder()).paymentRecord?.assignment.person.emails, []);
  }
);

dbTest(
  'preview uses the stored final cents, not indicative prices, and creation persists ID, reference and actor history',
  async (t) => {
    const s = await setup(t);
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
    assert.deepEqual(view.record?.operation?.snapshot, preview.snapshot);
    assert.equal(view.record?.operation?.hash, preview.hash);
    const stored = await getDb()
      .selectFrom('sammel.payment')
      .select(['contribution_id', 'contribution_reference', 'operation_state'])
      .executeTakeFirstOrThrow();
    assert.deepEqual(stored, {
      contribution_id: FEE.id,
      contribution_reference: FEE.reference,
      operation_state: 'created',
    });
    assert.deepEqual(
      view.events.map((event) => event.action),
      ['assigned', 'prepared', 'attempted', 'created']
    );
    assert.ok(view.events.every((event) => event.actor.id === 'staff'));
    assert.equal(view.order.payment?.reference, FEE.reference);
    assert.equal(view.record?.dispatch, null);
    assert.equal(view.order.paid, false);
    assert.equal((await s.action({ action: 'create', hash: preview.hash })).status, 200);
    assert.equal(s.calls.length, 1);
  }
);

dbTest('contribution descriptions do not repeat an existing Sammelbestellung prefix', async (t) => {
  const s = await setup(t);
  await changeCampaign({ title: 'Sammelbestellung Test Leitende' });
  await s.assign();
  assert.equal(
    (await s.preview()).snapshot.description,
    'Sammelbestellung Test Leitende · Bestellung 2'
  );
});

dbTest(
  'saving an order without a total keeps the amount open and never looks up prices',
  async (t) => {
    const s = await setup(t);
    const lookup = t.mock.method(products, 'getShopProduct', async () => {
      throw new Error('Shop unavailable');
    });
    assert.equal((await s.status({ totalCents: 3100 })).status, 204);
    assert.equal((await loadOrder()).totalCents, 3100);
    assert.equal((await s.status({ totalCents: null })).status, 204);
    assert.equal((await loadOrder()).totalCents, null);
    assert.equal(lookup.mock.callCount(), 0);
  }
);

dbTest(
  'creation requires a valid final amount, locked processing status and unchanged preview',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    for (const amount of [null, 0]) {
      await changeOrder({ total_cents: amount });
      assert.equal((await s.action({ action: 'preview' })).status, 400);
    }
    await changeOrder({ total_cents: 2400 });
    const p = await s.preview();
    await changeOrder({ total_cents: 2500 });
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
    await changeOrder({ total_cents: 2400 });
    for (const status of ['Eingereicht', 'Storniert'] as const) {
      await changeOrder({ status });
      assert.equal((await s.action({ action: 'preview' })).status, 409);
    }
    for (const amount of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1, 10_000_001]) {
      assert.equal((await s.status({ totalCents: amount })).status, 400);
    }
    assert.equal(s.calls.length, 0);
  }
);

dbTest('disabled creation cannot dispatch a contribution', async (t) => {
  const s = await setup(t);
  await s.assign();
  const p = await s.preview();
  const original = env.getEnvironment;
  t.mock.method(env, 'getEnvironment', (name: env.EnvironmentVariable) =>
    name === env.EnvironmentVariable.SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED
      ? 'false'
      : original(name)
  );
  assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 503);
  assert.equal((await loadOrder()).paymentRecord?.operation, null);
  assert.equal(s.calls.length, 0);
});

dbTest(
  'a missing creation gate defaults to disabled, and a missing token does not reserve an operation',
  async (t) => {
    const s = await setup(t);
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
  }
);

dbTest(
  'archived and paid orders do not create new contributions; former selected members are rejected',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    const p = await s.preview();
    await changeCampaign({ archived: true });
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
    await changeCampaign({ archived: false });
    await changeOrder({ paid: true });
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
    await changeOrder({ paid: false });
    t.mock.method(campflow, 'campflowGetAll', async () => []);
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 400);
    assert.equal(s.calls.length, 0);
  }
);

dbTest('two concurrent staff creations reserve at most one external write', async (t) => {
  const s = await setup(t);
  await s.assign();
  const p = await s.preview();
  const body = { action: 'create', confirmed: true, etag: await orderVersion(), hash: p.hash };
  const results = await Promise.all([
    SammelStaffPayment(s.request(body), s.context),
    SammelStaffPayment(s.request(body), s.context),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(s.calls.length, 1);
  const events = (await loadOrder()).paymentEvents.map((event) => event.action);
  assert.deepEqual(events, ['assigned', 'prepared', 'attempted', 'created']);
});

dbTest(
  'timeout after remote creation leaves a locked uncertain record and never resends',
  async (t) => {
    const s = await setup(t);
    t.mock.method(fees, 'createCampflowFee', async (snapshot: SammelBillingSnapshot) => {
      s.calls.push(snapshot);
      throw new fees.CampflowFeeUncertainError('timeout');
    });
    assert.equal((await s.createFee()).status, 502);
    const current = await loadOrder();
    assert.equal(current.paymentRecord?.operation?.state, 'uncertain');
    assert.equal(current.paymentRecord?.operation?.errorCategory, 'timeout');
    const p = await s.preview();
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
    assert.equal(s.calls.length, 1);
    await changeCampaign({ archived: true });
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
  }
);

dbTest(
  'an ambiguous dispatch reservation never sends, even when persisted as attempted',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    const p = await s.preview();
    failWrite(t, (state) => state === 'attempted', { after: true });
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 502);
    assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation?.state, 'attempted');
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
    assert.equal(s.calls.length, 0);
  }
);

dbTest(
  'a crash after preparation can resume only through another version-checked reservation',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    const p = await s.preview();
    const write = failWrite(t, (state) => state === 'attempted', { error: new Error('Crash') });
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 502);
    assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation?.state, 'prepared');
    assert.equal(s.calls.length, 0);
    write.mock.restore();
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 200);
    assert.equal(s.calls.length, 1);
  }
);

dbTest(
  'legacy prepared contributions retain their original payload without a new accounting assignment',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    const preview = await s.preview();
    // Stop before the attempted reservation; the prepared record is safe to resume.
    const probe = failWrite(t, (state) => state === 'attempted', { error: new Error('Stopped') });
    await s.action({ action: 'create', hash: preview.hash });
    probe.mock.restore();
    const snapshot = { ...(await loadOrder()).paymentRecord!.operation!.snapshot };
    delete snapshot.attachedExpense;
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    await getDb()
      .updateTable('sammel.payment')
      .set({ snapshot_costunit_name: null, snapshot_category_name: null, operation_hash: hash })
      .execute();
    assert.equal((await s.action({ action: 'create', hash })).status, 200);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].attachedExpense, undefined);
  }
);

dbTest(
  'a prepared contribution resumes with its stored payload after the campaign is renamed',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    const preview = await s.preview();
    const probe = failWrite(t, (state) => state === 'attempted', { error: new Error('Stopped') });
    await s.action({ action: 'create', hash: preview.hash });
    probe.mock.restore();
    await changeCampaign({ title: 'Frühjahr (umbenannt)' });
    const resumed = await s.preview();
    assert.equal(resumed.hash, preview.hash);
    assert.equal((await s.action({ action: 'create', hash: resumed.hash })).status, 200);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].description, preview.snapshot.description);
    assert.equal(s.calls[0].attachedExpense?.costunitName, 'Frühjahr');
  }
);

dbTest('adopting an existing contribution does not record a payment marking', async (t) => {
  const s = await setup(t);
  await s.assign();
  const p = await s.preview();
  const adopted = await s.action({
    action: 'adopt',
    hash: p.hash,
    feeId: FEE.id,
    reference: FEE.reference,
    evidence: 'Im Dashboard geprüft.',
  });
  assert.equal(adopted.status, 200);
  const current = await loadOrder();
  assert.equal(current.paymentRecord?.operation?.state, 'created');
  assert.equal(current.paymentRecord?.settlement, null);
  assert.ok(!current.paymentEvents.some((event) => event.action === 'settled'));
  assert.equal(current.paymentEvents.at(-1)?.evidence, 'Im Dashboard geprüft.');
});

dbTest(
  'local result persistence retries conflicts without repeating the provider POST',
  async (t) => {
    const s = await setup(t);
    t.mock.method(fees, 'createCampflowFee', async (snapshot: SammelBillingSnapshot) => {
      s.calls.push(snapshot);
      // Someone else changes the order while CampFlow answers
      await changeOrder({ notes: 'Unrelated note' });
      return FEE;
    });
    assert.equal((await s.createFee()).status, 200);
    assert.equal(s.calls.length, 1);
    const order = await loadOrder();
    assert.equal(order.notes, 'Unrelated note');
    assert.equal(order.paymentRecord?.operation?.state, 'created');
  }
);

dbTest(
  'remote success followed by unavailable local persistence remains blocked across reloads',
  async (t) => {
    const s = await setup(t);
    failWrite(t, (state) => state === 'created' || state === 'uncertain', {
      error: new Error('Database unavailable'),
    });
    assert.equal((await s.createFee()).status, 502);
    assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation?.state, 'attempted');
    const p = await s.preview();
    assert.equal((await s.action({ action: 'create', hash: p.hash })).status, 409);
    assert.equal(s.calls.length, 1);
  }
);

dbTest(
  'member edits, amount changes, reopening, cancellations and article changes respect an active contribution lock',
  async (t) => {
    const s = await setup(t);
    assert.equal((await s.createFee()).status, 200);
    for (const change of [
      { totalCents: 2500 },
      { status: 'Eingereicht' },
      { status: 'Storniert' },
    ]) {
      assert.equal((await s.status(change)).status, 400);
    }
    assert.equal(
      (
        await SammelStaffItem(
          s.request({ etag: await orderVersion(), index: 0, excluded: true }, 'PATCH'),
          s.context
        )
      ).status,
      400
    );
    const member = {
      id: '2',
      token: sammelToken('order', '2'),
      etag: await orderVersion(),
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
    assert.ok(!json.includes('per_A'));
    assert.equal((lookup.jsonBody as { canEdit: boolean }).canEdit, false);
    assert.equal((await s.status({ status: 'Eingetroffen', delivered: true })).status, 204);
  }
);

dbTest(
  'manual payment marking is audited, leaves delivery independent and dispatch requires evidence',
  async (t) => {
    const s = await setup(t);
    await s.createFee();
    assert.equal((await s.action({ action: 'dispatched', evidence: '' })).status, 400);
    const dispatched = await s.action({
      action: 'dispatched',
      evidence: 'Am 1. Oktober im Dashboard an family@example.test verschickt',
    });
    assert.equal(dispatched.status, 200);
    assert.equal((await s.action({ action: 'dispatched', evidence: 'Again' })).status, 409);
    assert.equal((await s.status({ paid: true })).status, 204);
    const current = await loadOrder();
    assert.equal(current.paid, true);
    assert.equal(current.paymentRecord?.settlement?.source, 'manual');
    assert.equal(current.paymentRecord?.settlement?.paid, true);
    assert.equal(current.paymentRecord?.settlement?.actor.id, 'staff');
    assert.equal(current.paymentEvents.at(-1)?.action, 'settled');
    assert.equal(current.delivered, false);
    assert.equal(s.calls.length, 1);
  }
);

dbTest(
  'manual adoption requires completed-execution confirmation and a unique contribution ID',
  async (t) => {
    const s = await setup(t, { secondOrder: true });
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
    // Order 3 adopts the same fee first
    const other = await s.action({ action: 'assign', personId: 'per_C', reason: 'Test' }, '3');
    assert.equal(other.status, 200);
    const otherPreview = (await s.action({ action: 'preview' }, '3'))
      .jsonBody as SammelPaymentPreview;
    assert.equal((await s.action({ ...body, hash: otherPreview.hash }, '3')).status, 200);
    const conflict = await s.action(body);
    assert.equal(conflict.status, 409);
    assert.equal((conflict.jsonBody as { code: string }).code, 'CONTRIBUTION_ASSIGNMENT_CONFLICT');
    assert.equal((await loadOrder()).paymentRecord?.operation, null);
    assert.equal(s.calls.length, 0);
    assert.equal((await s.action({ ...body, feeId: 'fee_Two' })).status, 200);
  }
);

dbTest('legacy orders remain manual; corrupt stored payment data fails closed', async (t) => {
  const s = await setup(t);
  const legacy = await SammelStaffPayment(s.request({}, 'GET'), s.context);
  assert.equal((legacy.jsonBody as SammelPaymentView).record, null);
  assert.equal((legacy.jsonBody as SammelPaymentView).order.payment, undefined);
  await s.createFee();
  const row = await getDb().selectFrom('sammel.payment').selectAll().executeTakeFirstOrThrow();
  const corruptions: [Updateable<SammelPaymentTable>, Updateable<SammelPaymentTable>][] = [
    [{ person_id: 'not-a-person' }, { person_id: row.person_id }],
    [{ snapshot_person_id: 'per_Other' }, { snapshot_person_id: row.snapshot_person_id }],
    [{ operation_hash: 'xyz' }, { operation_hash: row.operation_hash }],
    [{ snapshot_order_id: 3 }, { snapshot_order_id: 2 }],
  ];
  for (const [corrupt, restore] of corruptions) {
    await getDb().updateTable('sammel.payment').set(corrupt).execute();
    const result = await SammelStaffPayment(s.request({}, 'GET'), s.context);
    assert.equal(result.status, 503);
    assert.match((result.jsonBody as { message: string }).message, /Eintrag 2: Das Feld Zahlung/);
    await getDb().updateTable('sammel.payment').set(restore).execute();
  }
  assert.equal((await SammelStaffPayment(s.request({}, 'GET'), s.context)).status, 200);
  await changeOrder({ total_cents: 2500 });
  assert.equal((await SammelStaffPayment(s.request({}, 'GET'), s.context)).status, 503);
  await changeOrder({ total_cents: 2400 });
  await getDb().deleteFrom('sammel.payment_event').execute();
  const missingHistory = await SammelStaffPayment(s.request({}, 'GET'), s.context);
  assert.match(
    (missingHistory.jsonBody as { message: string }).message,
    /Das Feld Zahlungsprotokoll/
  );
});

dbTest(
  'the database refuses a contribution without an operation and a second order for one fee',
  async (t) => {
    const s = await setup(t, { secondOrder: true });
    await s.createFee();
    await assert.rejects(
      getDb().updateTable('sammel.payment').set({ contribution_id: null }).execute()
    );
    const row = await getDb().selectFrom('sammel.payment').selectAll().executeTakeFirstOrThrow();
    const copy = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date ? value.toISOString() : value,
      ])
    ) as Insertable<SammelPaymentTable>;
    await assert.rejects(
      getDb()
        .insertInto('sammel.payment')
        .values({ ...copy, order_id: 3, operation_key: '00000000-0000-4000-8000-000000000003' })
        .execute(),
      (error: unknown) => list.isSammelDuplicate(error)
    );
  }
);

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

dbTest('a stale preview version cannot reserve or dispatch a fee', async (t) => {
  const s = await setup(t);
  await s.assign();
  const p = await s.preview();
  const stale = await orderVersion();
  await changeOrder({ notes: 'Geändert' });
  const result = await SammelStaffPayment(
    s.request({ action: 'create', etag: stale, hash: p.hash, confirmed: true }),
    s.context
  );
  assert.equal(result.status, 409);
  assert.equal(s.calls.length, 0);
  assert.equal((await loadOrder()).paymentRecord?.operation, null);
});

dbTest('an uncertain contribution blocks payment marking and person reassignment', async (t) => {
  const s = await setup(t);
  t.mock.method(fees, 'createCampflowFee', async () => {
    throw new fees.CampflowFeeUncertainError('timeout');
  });
  await s.createFee();
  assert.equal((await s.action({ action: 'assign', personId: 'per_B' })).status, 409);
  assert.equal((await s.status({ paid: true })).status, 400);
  assert.equal((await s.action({ action: 'dispatched', evidence: 'Unverified' })).status, 409);
});

dbTest('a long payment history has no upper limit and keeps its order', async (t) => {
  const s = await setup(t);
  await s.assign();
  const event = {
    order_id: 2,
    at: '2026-10-01T00:00:00.000Z',
    actor_id: 'staff',
    actor_name: 'staff@example.test',
    action: 'assigned' as const,
    operation_key: null,
    evidence: 'Ältere Zuordnung',
  };
  for (let index = 0; index < 3; index++)
    await getDb()
      .insertInto('sammel.payment_event')
      .values(Array.from({ length: 50 }, () => event))
      .execute();
  assert.equal((await s.createFee()).status, 200);
  assert.equal((await s.status({ paid: true })).status, 204);
  const history = (await loadOrder()).paymentEvents;
  assert.equal(history.length, 156);
  assert.deepEqual(
    history.slice(-5).map((entry) => entry.action),
    ['assigned', 'prepared', 'attempted', 'created', 'settled']
  );
});

test('the provider adapter sends one documented array payload and validates a complete 201 response', async (t) => {
  const snapshot: SammelBillingSnapshot = {
    personId: 'per_A',
    amount: 2400,
    description: 'Bestellung 2',
    orderId: '2',
    campaignId: '1',
    revision: 'a'.repeat(64),
    attachedExpense: { costunitName: 'Frühjahr', categoryName: 'Bestellungen' },
  };
  t.mock.method(env, 'getEnvironment', () => 'test');
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
  t.mock.method(env, 'getEnvironment', () => 'test');
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

dbTest(
  'crash recovery keeps the operation payload immutable even for prepared records',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    const p = await s.preview();
    failWrite(t, (state) => state === 'attempted', { error: new Error('Crash') });
    await s.action({ action: 'create', hash: p.hash });
    const current = await loadOrder();
    const campaign = (await getSammelCampaign('1'))!;
    current.items = [{ ...ITEM, quantity: 3 }];
    const changed = sammelBillingPreview(current, campaign);
    await assert.rejects(createSammelContribution(current, campaign, changed.hash, PRINCIPAL));
    assert.equal(s.calls.length, 0);
  }
);

dbTest(
  'a returned contribution stays visible when its ID is already stored on another order',
  async (t) => {
    const s = await setup(t, { secondOrder: true });
    await s.action({ action: 'assign', personId: 'per_C', reason: 'Test' }, '3');
    const otherPreview = (await s.action({ action: 'preview' }, '3'))
      .jsonBody as SammelPaymentPreview;
    await s.action(
      {
        action: 'adopt',
        hash: otherPreview.hash,
        feeId: FEE.id,
        reference: FEE.reference,
        evidence: 'Geprüft',
      },
      '3'
    );
    const result = await s.createFee();
    assert.equal(result.status, 502);
    assert.match(JSON.stringify(result.jsonBody), new RegExp(`${FEE.id}.*${FEE.reference}`));
    const stored = await getSammelOrder('2');
    assert.equal(stored?.paymentRecord?.operation?.state, 'uncertain');
    assert.equal(
      stored?.paymentEvents.at(-1)?.evidence,
      `result_persistence: CampFlow meldete ${FEE.id} / ${FEE.reference}`
    );
    assert.equal(s.calls.length, 1);
  }
);

dbTest('overlong campaign titles are rejected before a payment operation is stored', async (t) => {
  const s = await setup(t);
  await changeCampaign({ title: 'A'.repeat(101) });
  await s.assign();
  assert.equal((await s.action({ action: 'preview' })).status, 400);
  assert.equal((await s.action({ action: 'create', hash: 'a'.repeat(64) })).status, 400);
  assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation ?? null, null);
  assert.equal(s.calls.length, 0);
});

dbTest(
  'mapping prerequisites run while prepared and may be retried without a fee attempt',
  async (t) => {
    const s = await setup(t);
    await s.assign();
    const preview = await s.preview();
    t.mock.method(playwright, 'ensureCampflowExpenseAssignment', async () => {
      const order = await loadOrder();
      assert.equal(order.paymentRecord?.operation?.state, 'prepared');
      assert.equal(
        order.paymentEvents.some((event) => event.action === 'attempted'),
        false
      );
      throw new playwright.PlaywrightApiError(504, 'Timeout after mapping write');
    });
    const result = await s.action({ action: 'create', hash: preview.hash });
    assert.equal(result.status, 503);
    assert.equal((result.jsonBody as { code: string }).code, 'CAMPFLOW_MAPPING_REQUIRED');
    assert.equal(s.calls.length, 0);
    const prepared = await loadOrder();
    assert.equal(prepared.paymentRecord?.operation?.state, 'prepared');
    const key = prepared.paymentRecord?.operation?.key;
    const mapping = t.mock.method(
      playwright,
      'ensureCampflowExpenseAssignment',
      async () => undefined
    );
    const retried = await s.action({ action: 'create', hash: preview.hash });
    assert.equal(retried.status, 200);
    assert.equal(s.calls.length, 1);
    assert.deepEqual(mapping.mock.calls[0].arguments.slice(0, 3), [
      'Frühjahr',
      'Bestellungen',
      'business',
    ]);
    const saved = await loadOrder();
    assert.equal(saved.paymentRecord?.operation?.key, key);
    assert.equal(saved.paymentRecord?.operation?.state, 'created');
  }
);

dbTest('missing Playwright credentials fail before reservation or fee creation', async (t) => {
  const s = await setup(t);
  await s.assign();
  const preview = await s.preview();
  t.mock.method(env, 'getEnvironment', (name: env.EnvironmentVariable) => {
    if (name === env.EnvironmentVariable.PLAYWRIGHT_API_KEY) throw new Error('Missing key');
    if (name === env.EnvironmentVariable.SAMMELBESTELLUNG_CAMPFLOW_CREATE_ENABLED) return 'true';
    return 'test';
  });
  const result = await s.action({ action: 'create', hash: preview.hash });
  assert.equal(result.status, 503);
  assert.equal(s.calls.length, 0);
  assert.equal(s.mapping.mock.callCount(), 0);
  assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation, null);
});

dbTest('slow mapping leaves the operation prepared when no fee budget remains', async (t) => {
  const s = await setup(t);
  await s.assign();
  const p = await s.preview();
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const order = await loadOrder();
  const campaign = (await getSammelCampaign('1'))!;
  t.mock.method(playwright, 'ensureCampflowExpenseAssignment', async () => {
    now += 16_000;
  });
  await assert.rejects(
    createSammelContribution(order, campaign, p.hash, PRINCIPAL, { deadline: now + 40_000 }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'PAYMENT_DEADLINE'
  );
  assert.equal(s.calls.length, 0);
  const prepared = await loadOrder();
  assert.equal(prepared.paymentRecord?.operation?.state, 'prepared');
  assert.equal(
    prepared.paymentEvents.some((event) => event.action === 'attempted'),
    false
  );
});

dbTest('time spent loading the members counts against the handler deadline', async (t) => {
  const s = await setup(t);
  await s.assign();
  const p = await s.preview();
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(campflow, 'campflowGetAll', async () => {
    now += 16_000;
    return structuredClone(PERSONS);
  });
  const result = await s.action({ action: 'create', hash: p.hash });
  assert.equal(result.status, 503);
  assert.equal((result.jsonBody as { code: string }).code, 'PAYMENT_DEADLINE');
  assert.equal(s.mapping.mock.callCount(), 0);
  assert.equal(s.calls.length, 0);
  assert.equal((await getSammelOrder('2'))?.paymentRecord?.operation?.state, 'prepared');
});

test('the fee adapter honors the caller deadline without retrying', async (t) => {
  t.mock.method(env, 'getEnvironment', () => 'test');
  const signal = AbortSignal.abort();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(init.signal?.aborted, true);
    throw new DOMException('Aborted', 'AbortError');
  });
  await assert.rejects(
    createFeeFromApi(
      {
        personId: 'per_A',
        amount: 2400,
        description: 'Bestellung 2',
        orderId: '2',
        campaignId: '1',
        revision: 'a'.repeat(64),
      },
      { signal }
    ),
    (error: unknown) =>
      error instanceof fees.CampflowFeeUncertainError && error.category === 'timeout'
  );
  assert.equal(calls, 1);
});

dbTest(
  'payment views report the current campaign archive state on reads and assignment responses',
  async (t) => {
    const s = await setup(t);
    const read = async () => {
      const result = await SammelStaffPayment(s.request({}, 'GET'), s.context);
      assert.equal(result.status, 200);
      return result.jsonBody as SammelPaymentView;
    };
    assert.equal((await read()).campaignArchived, false);
    assert.equal((await s.assign()).campaignArchived, false);
    await changeCampaign({ archived: true });
    assert.equal((await read()).campaignArchived, true);
  }
);

dbTest(
  'a change committed between the reads of an order is never mixed with the old version',
  async (t) => {
    const s = await setup(t);
    await s.assign('per_C', 'Erste Begründung');
    const real = getDb();
    let changes = 0;
    // Commits a change of the payment right after the order row was read, before its children
    const plugin: KyselyPlugin = {
      transformQuery: (args) => args.node,
      async transformResult(args) {
        const first = args.result.rows[0] as Record<string, unknown> | undefined;
        if (changes === 0 && first && 'link_sent_at' in first) {
          changes++;
          await real.transaction().execute(async (trx) => {
            await trx
              .updateTable('sammel.payment')
              .set({ assignment_reason: 'Geänderte Begründung' })
              .execute();
            await trx.updateTable('sammel.member_order').set({ notes: 'Geändert' }).execute();
          });
        }
        return args.result;
      },
    };
    t.mock.method(db, 'getDb', () => real.withPlugin(plugin));
    const order = await loadOrder();
    t.mock.restoreAll();
    assert.equal(changes, 1);
    assert.equal(order.paymentRecord?.assignment.reason, 'Geänderte Begründung');
    assert.equal(order.notes, 'Geändert');
    assert.equal(order.etag, await orderVersion());
  }
);
