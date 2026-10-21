import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as db from '../lib/db';
import { getDb, VersionConflictError } from '../lib/db';
import * as altcha from '../lib/altcha';
import * as env from '../lib/environment';
import * as mail from '../lib/mail';
import * as list from '../lib/sammelbestellung-list';
import { TEST_ALTCHA_SECRET, solvedAltcha, useAltcha, withoutAltcha } from './fixtures/altcha';
import { dbTest } from './fixtures/database';
import { recordQueries } from './fixtures/queries';
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
import { reserveSammelLinkRequest } from '../lib/sammelbestellung-link-quota';
import {
  sammelToken,
  ensureSammelOrder,
  createSammelCampaign,
  getSammelCampaign,
  verifySammelToken,
} from '../lib/sammelbestellung-list';
import {
  validateSammelItems,
  validateSammelCatalog,
  validateSammelCampaign,
  validateSammelStatus,
} from '../lib/sammelbestellung-validation';
import { canEditSammelOrder, isSammelOpen } from '../lib/sammelbestellung-model';
import type { SammelAktion, SammelBestellung } from '../lib/sammelbestellung-model';
import { aggregateSammelItems, sammelCsv, sammelReceipt } from '../lib/sammelbestellung-export';
import {
  SammelCampaignLookup,
  SammelOrderLookup,
  SammelOrderSave,
  SammelProductLookup,
  SammelRequestLink,
} from '../endpoints/sammelbestellungen';
import {
  SammelStaffCampaigns,
  SammelStaffCampaign,
  SammelStaffOrder,
  SammelStaffMessage,
  SammelStaffProduct,
  SammelStaffItem,
  SammelStaffInvite,
} from '../endpoints/intern-pflege-sammelbestellungen';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

/** Accepts any proof of work unless `realAltcha` is set. */
function setup(t: TestContext, { realAltcha = false } = {}): InvocationContext {
  t.mock.method(env, 'getEnvironment', (name: env.EnvironmentVariable) => {
    if (name === env.EnvironmentVariable.SAMMELBESTELLUNG_LINK_SECRET)
      return 'test-secret-with-more-than-thirty-two-characters';
    if (name === env.EnvironmentVariable.KONTAKT_ALTCHA_SECRET) return TEST_ALTCHA_SECRET;
    throw new Error(`Unexpected environment variable: ${name}`);
  });
  useAltcha(t);
  if (!realAltcha) t.mock.method(altcha, 'verifyAltchaPayload', async () => true);
  t.mock.method(mail, 'sendMail', async () => undefined);
  const context = new InvocationContext({ functionName: 'sammel-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

/** Fails the test if a handler touches the database. */
function forbidDatabase(t: TestContext): void {
  t.mock.method(db, 'getDb', () => {
    throw new Error('Must not read');
  });
}

function request(body: unknown, method = 'POST', principal?: unknown, id = '2'): HttpRequest {
  return new HttpRequest({
    url: 'https://example.test/api/sammelbestellungen',
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
}

const memberBody = async (): Promise<Record<string, unknown>> => ({
  id: '2',
  token: sammelToken('order', '2'),
  etag: await orderVersion(),
  name: 'Familie Test',
  notes: '',
  items: [ITEM],
});
const invitation = (): Record<string, unknown> => ({
  id: '1',
  token: sammelToken('campaign', '1'),
  email: ' FAMILY@EXAMPLE.TEST ',
});

async function orderCount(): Promise<number> {
  const row = await getDb()
    .selectFrom('sammel.member_order')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

dbTest('corrupt stored catalog and articles identify the row and field', async (t) => {
  const context = setup(t);
  await seedSammel(
    [
      sammelCampaign({
        catalog: [{ name: ITEM.name, reference: ITEM.reference, variants: ['164'] }],
      }),
    ],
    [sammelOrder()]
  );
  await getDb()
    .updateTable('sammel.catalog_item')
    .set({ reference: 'https://evil.test/x' })
    .execute();
  for (const endpoint of [SammelOrderLookup, SammelStaffCampaign, SammelStaffCampaigns]) {
    const result = await endpoint(
      endpoint === SammelOrderLookup
        ? request(await memberBody())
        : request({}, 'GET', PRINCIPAL, '1'),
      context
    );
    assert.equal(result.status, 503);
    const body = result.jsonBody as { code: string; message: string };
    assert.equal(body.code, 'INVALID_STORED_DATA');
    assert.match(body.message, /Eintrag 1: Das Feld Katalog/);
  }
  await getDb().updateTable('sammel.catalog_item').set({ reference: ITEM.reference }).execute();
  const member = await memberBody();
  await getDb()
    .updateTable('sammel.order_item')
    .set({ reference: 'javascript:alert(1)' })
    .execute();
  for (const endpoint of [SammelOrderLookup, SammelStaffCampaign]) {
    const result = await endpoint(
      endpoint === SammelOrderLookup ? request(member) : request({}, 'GET', PRINCIPAL, '1'),
      context
    );
    assert.equal(result.status, 503);
    assert.match((result.jsonBody as { message: string }).message, /Eintrag 2: Das Feld Artikel/);
  }
});

dbTest('only unsubmitted orders may be stored without articles', async (t) => {
  const context = setup(t);
  await seedSammel([sammelCampaign()], [sammelOrder({ items: [], submitted: false })]);
  const body = await memberBody();
  assert.equal((await SammelOrderLookup(request(body), context)).status ?? 200, 200);
  await changeOrder({ submitted: true });
  assert.equal((await SammelOrderLookup(request(body), context)).status, 503);
});

test('staff routes reject anonymous users, other providers and foreign tenant claims before reading data', async (t) => {
  const context = setup(t);
  forbidDatabase(t);
  for (const endpoint of [
    SammelStaffCampaigns,
    SammelStaffCampaign,
    SammelStaffOrder,
    SammelStaffMessage,
    SammelStaffProduct,
    SammelStaffItem,
    SammelStaffInvite,
  ]) {
    for (const principal of [
      undefined,
      { ...PRINCIPAL, identityProvider: 'github' },
      { ...PRINCIPAL, userRoles: [] },
    ]) {
      assert.equal((await endpoint(request({}, 'GET', principal), context)).status, 401);
    }
    assert.equal(
      (
        await endpoint(
          request({}, 'GET', { ...PRINCIPAL, claims: [{ typ: 'tid', val: 'wrong' }] }),
          context
        )
      ).status,
      403
    );
  }
});

test('campaign tokens cannot read orders and forged or malformed tokens never load personal data', async (t) => {
  const context = setup(t);
  forbidDatabase(t);
  for (const token of [
    '',
    'x'.repeat(43),
    sammelToken('campaign', '2'),
    sammelToken('order', '3'),
  ]) {
    for (const endpoint of [SammelOrderLookup, SammelOrderSave, SammelProductLookup]) {
      const response = await endpoint(request({ id: '2', token }), context);
      assert.equal(response.status, 404);
      assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
    }
  }
  assert.equal(verifySammelToken('order', '2', sammelToken('order', '2')), true);
  assert.equal(verifySammelToken('campaign', '2', sammelToken('order', '2')), false);
});

dbTest('member views expose only one order and remain readable after the deadline', async (t) => {
  const context = setup(t);
  await seedSammel(
    [sammelCampaign({ endsAt: '2021-01-01T00:00:00.000Z' })],
    [sammelOrder({ linkSentAt: '2020-06-01T00:00:00.000Z' })]
  );
  const response = await SammelOrderLookup(request(await memberBody()), context);
  const body = response.jsonBody as { order: Record<string, unknown>; canEdit: boolean };
  assert.equal(body.canEdit, false);
  assert.equal(body.order.email, 'family@example.test');
  assert.equal('linkSentAt' in body.order, false);
  assert.equal('token' in body.order, false);
});

dbTest(
  'campaign invitations and member writes reject closed periods and processing states',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const before = await orderVersion();
    for (const [starts, ends] of [
      ['2098-01-01', '2099-01-01'],
      ['2020-01-01', '2021-01-01'],
    ]) {
      await changeCampaign({ starts_at: starts, ends_at: ends });
      assert.equal((await SammelOrderSave(request(await memberBody()), context)).status, 403);
      assert.equal((await SammelCampaignLookup(request(invitation()), context)).status, 403);
      assert.equal((await SammelRequestLink(request(invitation()), context)).status, 403);
    }
    await changeCampaign({ starts_at: '2020-01-01', ends_at: '2099-01-01' });
    for (const status of ['Bestellt', 'Eingetroffen', 'Storniert'] as const) {
      await changeOrder({ status });
      assert.equal((await SammelOrderSave(request(await memberBody()), context)).status, 403);
    }
    await changeOrder({ status: 'Eingereicht' });
    const unchanged = await loadOrder();
    assert.equal(unchanged.name, 'Familie Test');
    assert.notEqual(unchanged.etag, before);
    assert.equal(await orderCount(), 1);
  }
);

dbTest(
  'member edits use the loaded version, reset a previous price and ignore privileged fields',
  async (t) => {
    const context = setup(t);
    await seedSammel([sammelCampaign()], [sammelOrder({ submitted: false, totalCents: 990 })]);
    const loaded = await memberBody();
    const response = await SammelOrderSave(
      request({
        ...loaded,
        name: 'Familie Neu',
        items: [{ ...ITEM, quantity: 3 }],
        email: 'attacker@example.test',
        paid: true,
        status: 'Bestellt',
        totalCents: 1,
      }),
      context
    );
    assert.equal(response.status, 200);
    const saved = await loadOrder();
    assert.equal(saved.name, 'Familie Neu');
    assert.deepEqual(saved.items, [{ ...ITEM, quantity: 3 }]);
    assert.equal(saved.submitted, true);
    assert.equal(saved.totalCents, null);
    assert.equal(saved.paid, false);
    assert.equal(saved.status, 'Eingereicht');
    assert.equal(saved.email, 'family@example.test');
    for (const etag of ['', '*', '"stale,1"', undefined, loaded.etag]) {
      const stale = await SammelOrderSave(request({ ...loaded, etag }), context);
      assert.ok(stale.status === 400 || stale.status === 409);
    }
    assert.equal((await loadOrder()).etag, saved.etag);
    // A write that loses the race after the version check is a conflict, not a server error
    t.mock.method(list, 'updateSammelOrder', async () => {
      throw new VersionConflictError();
    });
    assert.equal((await SammelOrderSave(request(await memberBody()), context)).status, 409);
  }
);

dbTest(
  'staff can lock orders, set the final amount and check payment/delivery with concurrency protection',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const etag = await orderVersion();
    const body = { etag, status: 'Eingetroffen', paid: true, delivered: true, totalCents: 12345 };
    assert.equal((await SammelStaffOrder(request(body, 'PATCH', PRINCIPAL), context)).status, 204);
    const saved = await loadOrder();
    assert.deepEqual(
      [saved.status, saved.paid, saved.delivered, saved.totalCents],
      ['Eingetroffen', true, true, 12345]
    );
    assert.equal((await SammelStaffOrder(request(body, 'PATCH', PRINCIPAL), context)).status, 409);
    assert.equal(
      (
        await SammelStaffOrder(
          request({ ...body, etag: saved.etag, status: 'Bestellt' }, 'PATCH', PRINCIPAL),
          context
        )
      ).status,
      400
    );
    assert.equal((await loadOrder()).etag, saved.etag);
  }
);

dbTest('the campaign and its orders are read together for staff', async (t) => {
  const context = setup(t);
  await seedSammel(
    [
      sammelCampaign({
        catalog: [{ name: ITEM.name, reference: ITEM.reference, variants: ['152', '164'] }],
      }),
      sammelCampaign({ id: '5', title: 'Andere' }),
    ],
    [
      sammelOrder(),
      sammelOrder({ id: '3', email: 'zweite@example.test', status: 'Bestellt', totalCents: 2400 }),
      sammelOrder({ id: '4', campaignId: '5', email: 'andere@example.test' }),
    ]
  );
  const get = (id: string) =>
    SammelStaffCampaign(request(undefined, 'GET', PRINCIPAL, id), context);
  const queries = recordQueries(t);
  const response = await get('1');
  assert.equal(response.status, 200);
  // Campaign and orders start together; the orders need three steps for their version check
  assert.equal(queries.roundTrips, 3);
  const campaign = await getSammelCampaign('1');
  assert.deepEqual(response.jsonBody, {
    campaign,
    invitationUrl: list.sammelUrl('https://www.stamm-phoenix.de', 'campaign', '1'),
    orders: (await list.getSammelOrders('1')).map(list.publicSammelOrder),
  });
  assert.deepEqual(
    (response.jsonBody as { orders: { id: string }[] }).orders.map((order) => order.id),
    ['2', '3']
  );
  assert.equal((await get('9')).status, 404);
  assert.equal((await get('x')).status, 404);
});

dbTest('staff can archive and restore campaigns with the loaded version', async (t) => {
  const context = setup(t);
  await seedSammel();
  const versions: string[] = [];
  for (const archived of [true, false]) {
    const etag = (await getSammelCampaign('1'))!.etag;
    versions.push(etag);
    const response = await SammelStaffCampaign(
      request({ etag, archived }, 'PATCH', PRINCIPAL, '1'),
      context
    );
    assert.equal(response.status, 204);
    assert.equal((await getSammelCampaign('1'))!.archived, archived);
  }
  assert.equal(
    (
      await SammelStaffCampaign(
        request({ etag: versions[0], archived: true }, 'PATCH', PRINCIPAL, '1'),
        context
      )
    ).status,
    409
  );
  const current = (await getSammelCampaign('1'))!;
  assert.equal(
    (
      await SammelStaffCampaign(
        request({ etag: current.etag, archived: 'true' }, 'PATCH', PRINCIPAL, '1'),
        context
      )
    ).status,
    400
  );
  assert.equal((await getSammelCampaign('1'))!.archived, false);
});

dbTest(
  'archived campaigns reject invitations and member writes but retain personal order views',
  async (t) => {
    const context = setup(t);
    await seedSammel([sammelCampaign({ archived: true })]);
    assert.equal((await SammelCampaignLookup(request(invitation()), context)).status, 403);
    assert.equal((await SammelRequestLink(request(invitation()), context)).status, 403);
    assert.equal((await SammelOrderSave(request(await memberBody()), context)).status, 403);
    assert.equal(
      (
        await SammelProductLookup(
          request({ ...(await memberBody()), reference: 'https://www.ruesthaus.de/1/test' }),
          context
        )
      ).status,
      403
    );
    const response = await SammelOrderLookup(request(await memberBody()), context);
    const view = response.jsonBody as { canEdit: boolean; campaign: SammelAktion };
    assert.equal(view.canEdit, false);
    assert.equal(view.campaign.archived, true);
  }
);

dbTest(
  'successful submissions and edits mail the saved contents to the stored recipient',
  async (t) => {
    const context = setup(t);
    await seedSammel([sammelCampaign()], [sammelOrder({ submitted: false, items: [] })]);
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    const body = async (): Promise<Record<string, unknown>> => ({
      ...(await memberBody()),
      name: '<Familie & Test>',
      notes: 'Erste Zeile\n<zweite>',
      email: 'attacker@example.test',
    });
    const first = await SammelOrderSave(request(await body()), context);
    assert.deepEqual(first.jsonBody, { confirmationMailSent: true });
    assert.equal(send.mock.calls[0].arguments[0], 'family@example.test');
    assert.match(String(send.mock.calls[0].arguments[1]), /Bestellung eingegangen/);
    const html = String(send.mock.calls[0].arguments[2]);
    assert.match(html, /&lt;Familie &amp; Test&gt;/);
    assert.match(html, /2 × Kluft/);
    assert.match(html, /164/);
    assert.match(html, /Artikelnummer: 00123/);
    assert.match(html, /Erste Zeile<br \/>&lt;zweite&gt;/);
    assert.ok(html.includes(sammelToken('order', '2')));
    assert.ok(!html.includes(sammelToken('campaign', '1')));
    await SammelOrderSave(
      request({ ...(await body()), items: [{ ...ITEM, quantity: 3 }] }),
      context
    );
    assert.equal(send.mock.callCount(), 2);
    assert.match(String(send.mock.calls[1].arguments[1]), /Bestellung aktualisiert/);
    assert.match(String(send.mock.calls[1].arguments[2]), /3 × Kluft/);
  }
);

dbTest('confirmation mail failure reports a saved order without repeating the write', async (t) => {
  const context = setup(t);
  await seedSammel();
  const before = await orderVersion();
  t.mock.method(mail, 'sendMail', async () => {
    throw new Error('Mail unavailable');
  });
  const response = await SammelOrderSave(request(await memberBody()), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { confirmationMailSent: false });
  assert.notEqual(await orderVersion(), before);
});

dbTest('stale versions and failed writes never send a confirmation mail', async (t) => {
  const context = setup(t);
  await seedSammel();
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const stale = await memberBody();
  await changeOrder({ notes: 'Von jemand anderem geändert' });
  assert.equal((await SammelOrderSave(request(stale), context)).status, 409);
  assert.equal(
    (await SammelOrderSave(request({ ...stale, etag: '"old,1"' }), context)).status,
    409
  );
  assert.equal((await loadOrder()).notes, 'Von jemand anderem geändert');
  assert.equal(send.mock.callCount(), 0);
});

dbTest(
  'staff messages use the stored recipient, sanitize formatting and sign with the acting user',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const etag = await orderVersion();
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    const response = await SammelStaffMessage(
      request(
        {
          etag,
          subject: 'Deine Bestellung ist da',
          message: '<p onclick="bad()">Hallo <strong>Familie</strong></p><script>alert(1)</script>',
          email: 'attacker@example.test',
        },
        'POST',
        { ...PRINCIPAL, claims: [{ typ: 'given_name', val: 'Alex' }] }
      ),
      context
    );
    assert.equal(response.status, 204);
    assert.equal(send.mock.calls[0].arguments[0], 'family@example.test');
    assert.equal(send.mock.calls[0].arguments[1], 'Frühjahr: Deine Bestellung ist da');
    const html = String(send.mock.calls[0].arguments[2]);
    assert.ok(html.includes('<strong>Familie</strong>'));
    assert.ok(!html.includes('onclick'));
    assert.ok(!html.includes('<script'));
    assert.ok(html.includes('Alex für das Sammelbestellteam'));
    assert.ok(html.includes(sammelToken('order', '2')));
    assert.equal(await orderVersion(), etag);
  }
);

dbTest(
  'staff messages reject stale versions and invalid messages and report mail failures',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    const body = {
      etag: await orderVersion(),
      subject: 'Abholung',
      message: '<p>Bitte abholen.</p>',
    };
    assert.equal(
      (await SammelStaffMessage(request({ ...body, etag: '"old,1"' }, 'POST', PRINCIPAL), context))
        .status,
      409
    );
    for (const invalid of [
      { subject: '' },
      { subject: 'x'.repeat(151) },
      { message: '<p></p>' },
      { message: 'x'.repeat(5001) },
    ]) {
      assert.equal(
        (await SammelStaffMessage(request({ ...body, ...invalid }, 'POST', PRINCIPAL), context))
          .status,
        400
      );
    }
    assert.equal(send.mock.callCount(), 0);
    send.mock.mockImplementation(async () => {
      throw new Error('Mail unavailable');
    });
    const failed = await SammelStaffMessage(request(body, 'POST', PRINCIPAL), context);
    assert.equal(failed.status, 502);
  }
);

dbTest(
  'repeated link requests adopt the same order and mail only a personal fragment link',
  async (t) => {
    const context = setup(t);
    await seedSammel([sammelCampaign()], []);
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    await SammelRequestLink(request(invitation()), context);
    assert.equal(await orderCount(), 1);
    const order = (await list.getSammelOrders('1'))[0];
    assert.equal(order.email, 'family@example.test');
    assert.equal(order.submitted, false);
    assert.ok(order.linkSentAt);
    assert.equal(send.mock.callCount(), 1);
    assert.equal(send.mock.calls[0].arguments[0], 'family@example.test');
    const html = String(send.mock.calls[0].arguments[2]);
    assert.ok(html.includes('/mitgliederbereich/sammelbestellungen#kind=order'));
    assert.ok(html.includes(sammelToken('order', order.id)));
    assert.ok(!html.includes(sammelToken('campaign', '1')));
    await SammelRequestLink(request(invitation()), context);
    await SammelRequestLink(request({ ...invitation(), website: 'bot.test' }), context);
    assert.equal(send.mock.callCount(), 1);
    assert.equal(await orderCount(), 1);
  }
);

dbTest(
  'link requests need a solved, unused proof of work before quota, order or mail',
  async (t) => {
    const context = setup(t, { realAltcha: true });
    await seedSammel([sammelCampaign()], []);
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    for (const proof of [undefined, 'bm90IGpzb24=', Buffer.from('{}').toString('base64')]) {
      const result = await SammelRequestLink(request({ ...invitation(), altcha: proof }), context);
      assert.equal(result.status, 403);
      assert.equal(result.jsonBody.code, 'CAPTCHA_FAILED');
    }
    assert.equal(
      await getDb().selectFrom('sammel.link_quota').select('campaign_id').executeTakeFirst(),
      undefined
    );
    assert.equal(await orderCount(), 0);
    const proof = await solvedAltcha();
    assert.equal(
      (await SammelRequestLink(request({ ...invitation(), altcha: proof }), context)).jsonBody.sent,
      true
    );
    assert.equal(send.mock.callCount(), 1);
    assert.equal(
      (await SammelRequestLink(request({ ...invitation(), altcha: proof }), context)).status,
      403
    );
    withoutAltcha(t);
    assert.equal((await SammelRequestLink(request(invitation()), context)).status, 503);
    assert.equal(send.mock.callCount(), 1);
  }
);

dbTest(
  'concurrent first link requests adopt one order, never insert a second logical order',
  async () => {
    await seedSammel([sammelCampaign()], []);
    const orders = await Promise.all(
      Array.from({ length: 5 }, () => ensureSammelOrder('1', 'family@example.test'))
    );
    assert.equal(new Set(orders.map((order) => order.id)).size, 1);
    assert.equal(await orderCount(), 1);
  }
);

dbTest(
  'mail failure clears the cooldown using the latest version without invalidating existing links',
  async (t) => {
    const context = setup(t);
    await seedSammel([sammelCampaign()], [sammelOrder({ submitted: false, items: [] })]);
    t.mock.method(mail, 'sendMail', async () => {
      throw new Error('mail unavailable');
    });
    const before = sammelToken('order', '2');
    assert.equal((await SammelRequestLink(request(invitation()), context)).status, 502);
    assert.equal((await loadOrder()).linkSentAt, '');
    assert.equal(sammelToken('order', '2'), before);
    t.mock.method(mail, 'sendMail', async () => undefined);
    assert.equal((await SammelRequestLink(request(invitation()), context)).jsonBody.sent, true);
    assert.ok((await loadOrder()).linkSentAt);
  }
);

dbTest(
  'concurrent cooldown reservation sends no additional mail and upstream failures stay private',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const update = t.mock.method(list, 'updateSammelOrder', async () => {
      throw new VersionConflictError();
    });
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    assert.equal((await SammelRequestLink(request(invitation()), context)).jsonBody.sent, true);
    assert.equal(update.mock.callCount(), 1);
    assert.equal(send.mock.callCount(), 0);
    const body = await memberBody();
    t.mock.method(db, 'getDb', () => {
      throw new Error('private database credentials');
    });
    const response = await SammelOrderLookup(request(body), context);
    assert.equal(response.status, 500);
    assert.ok(!JSON.stringify(response.jsonBody).includes('credentials'));
    assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
  }
);

dbTest(
  'campaign link quotas stop varying recipients before order creation or mail delivery',
  async (t) => {
    const context = setup(t);
    await seedSammel([sammelCampaign()], []);
    const hour = Math.floor(Date.now() / 3_600_000);
    const day = Math.floor(Date.now() / 86_400_000);
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    for (const quota of [
      { hour_count: 100, day_count: 100 },
      { hour_count: 0, day_count: 500 },
    ]) {
      await getDb().deleteFrom('sammel.link_quota').execute();
      await getDb()
        .insertInto('sammel.link_quota')
        .values({ campaign_id: 1, hour_window: hour, day_window: day, ...quota })
        .execute();
      for (const address of ['first@example.test', 'second@example.test']) {
        const result = await SammelRequestLink(
          request({ ...invitation(), email: address }),
          context
        );
        assert.equal(result.status, 429);
        assert.equal(result.jsonBody.code, 'LINK_LIMIT');
      }
    }
    assert.equal(await orderCount(), 0);
    assert.equal(send.mock.callCount(), 0);
  }
);

dbTest(
  'persistent link quotas retain daily counts, reset expired windows and hold under concurrency',
  async () => {
    await seedSammel([sammelCampaign()], []);
    const now = Date.UTC(2026, 9, 1, 12);
    const hour = Math.floor(now / 3_600_000);
    const day = Math.floor(now / 86_400_000);
    const quota = async (): Promise<unknown> =>
      getDb()
        .selectFrom('sammel.link_quota')
        .select(['hour_window', 'hour_count', 'day_window', 'day_count'])
        .executeTakeFirst();
    await getDb()
      .insertInto('sammel.link_quota')
      .values({
        campaign_id: 1,
        hour_window: hour - 1,
        hour_count: 100,
        day_window: day,
        day_count: 499,
      })
      .execute();
    assert.equal(await reserveSammelLinkRequest('1', now), true);
    assert.deepEqual(await quota(), {
      hour_window: hour,
      hour_count: 1,
      day_window: day,
      day_count: 500,
    });
    assert.equal(await reserveSammelLinkRequest('1', now), false);
    assert.equal(await reserveSammelLinkRequest('1', now + 86_400_000), true);
    assert.deepEqual(await quota(), {
      hour_window: hour + 24,
      hour_count: 1,
      day_window: day + 1,
      day_count: 1,
    });
    await getDb().updateTable('sammel.link_quota').set({ day_count: 495 }).execute();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveSammelLinkRequest('1', now + 86_400_000))
    );
    assert.equal(results.filter(Boolean).length, 5);
    assert.equal(await reserveSammelLinkRequest('999', now), false);
    assert.equal(await reserveSammelLinkRequest('x', now), false);
  }
);

test('validation bounds free-entry orders and rejects unsafe references, invalid dates and delivery states', () => {
  for (const input of [
    [],
    [{ ...ITEM, quantity: 0 }],
    [{ ...ITEM, quantity: 1.5 }],
    [{ ...ITEM, reference: 'javascript:alert(1)' }],
    [{ ...ITEM, reference: 'https://evil.test/x' }],
    [{ ...ITEM, reference: 'https://www.ruesthaus.de@evil.test/x' }],
    [{ ...ITEM, reference: 'https://user@ruesthaus.de/x' }],
    Array(41).fill(ITEM),
  ]) {
    assert.throws(() => validateSammelItems(input));
  }
  assert.deepEqual(validateSammelItems([ITEM]), [ITEM]);
  assert.throws(() =>
    validateSammelCampaign({
      title: 'Test',
      startsAt: '2027-02-30T00:00:00.000Z',
      endsAt: '2027-03-01T00:00:00.000Z',
      catalog: [],
    })
  );
  assert.throws(() =>
    validateSammelStatus({ status: 'Bestellt', paid: false, delivered: true, totalCents: null })
  );
});

test('opening/closing boundaries are enforced and exports exclude drafts/cancellations and neutralize formulas', () => {
  const campaign = {
    startsAt: '2027-01-01T00:00:00.000Z',
    endsAt: '2027-02-01T00:00:00.000Z',
  } as SammelAktion;
  const order = { status: 'Eingereicht', submitted: true, items: [ITEM] } as SammelBestellung;
  assert.equal(isSammelOpen(campaign, new Date(campaign.startsAt)), true);
  assert.equal(isSammelOpen(campaign, new Date(campaign.endsAt)), false);
  assert.equal(
    canEditSammelOrder(campaign, { ...order, status: 'Bestellt' }, new Date(campaign.startsAt)),
    false
  );
  assert.deepEqual(
    aggregateSammelItems([
      order,
      order,
      { ...order, status: 'Storniert' },
      { ...order, submitted: false },
    ]),
    [{ ...ITEM, quantity: 4 }]
  );
  const csv = sammelCsv([['=HYPERLINK("evil")', 'normal;cell', ' @SUM(1)', 3]]);
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"\' @SUM(1)"'));
  assert.ok(csv.includes('"normal;cell"'));
});

test('combined purchases merge matching references despite different names and keep variants separate', () => {
  const reference = 'https://www.ruesthaus.de/infobereich-sammelbestellen/2891/klufthemd-fairtrade';
  const first = { name: 'Klufthemd', reference, variant: '164', quantity: 2 };
  const orders = [
    {
      submitted: true,
      status: 'Eingereicht',
      items: [
        first,
        {
          ...first,
          name: 'Pfadfinderhemd',
          reference: ` ${reference} `,
          variant: ' 164 ',
          quantity: 3,
        },
        { ...first, variant: '170', quantity: 1 },
        { ...first, reference: '01234', quantity: 1 },
        { ...first, reference: '01234', name: 'Anderer Name', quantity: 4 },
        { ...first, reference: '05678', quantity: 6 },
      ],
    },
  ] as SammelBestellung[];
  const combined = aggregateSammelItems(orders);
  assert.equal(combined.length, 4);
  assert.deepEqual(
    combined.find((row) => row.reference === reference && row.variant === '164'),
    { ...first, quantity: 5 }
  );
  assert.equal(
    combined.find((row) => row.reference === reference && row.variant === '170')?.quantity,
    1
  );
  assert.equal(combined.find((row) => row.reference === '01234')?.quantity, 5);
  assert.equal(combined.find((row) => row.reference === '05678')?.quantity, 6);
});

dbTest(
  'campaign creation validates the catalog and stores a retry key, then adopts a previous creation',
  async (t) => {
    const context = setup(t);
    const creationKey = 'b0a8c20c-5a24-49ae-bc37-b5f13309908c';
    const input = {
      title: 'Sommer',
      description: '',
      startsAt: '2020-01-01T00:00:00.000Z',
      endsAt: '2099-01-01T00:00:00.000Z',
      catalog: [
        { name: ITEM.name, reference: ITEM.reference, variants: ['164'] },
        { shop: 'eschwege', name: 'Juja', reference: '3020', variants: ['M', 'L'] },
        { name: 'Halstuch', reference: 'stamm-halstuch', variants: [] },
      ],
      archived: false,
    };
    const created = await SammelStaffCampaigns(
      request({ ...input, creationKey }, 'POST', PRINCIPAL),
      context
    );
    assert.equal(created.status, 201);
    const { id } = created.jsonBody as { id: string };
    const campaign = await getSammelCampaign(id);
    assert.deepEqual(
      { ...campaign, id: undefined, etag: undefined },
      { ...validateSammelCampaign(input), id: undefined, etag: undefined }
    );
    assert.deepEqual(
      await getDb()
        .selectFrom('sammel.catalog_item')
        .select(['position', 'shop'])
        .orderBy('position')
        .execute(),
      [
        { position: 0, shop: 'ruesthaus' },
        { position: 1, shop: 'eschwege' },
        { position: 2, shop: 'stamm' },
      ]
    );
    assert.deepEqual(
      await getDb()
        .selectFrom('sammel.catalog_variant')
        .select(['item_position', 'variant'])
        .orderBy('item_position')
        .orderBy('position')
        .execute(),
      [
        { item_position: 0, variant: '164' },
        { item_position: 1, variant: 'M' },
        { item_position: 1, variant: 'L' },
      ]
    );
    assert.equal(await createSammelCampaign(validateSammelCampaign(input), creationKey), id);
    const again = await Promise.all(
      Array.from({ length: 3 }, () =>
        createSammelCampaign(validateSammelCampaign(input), 'c0a8c20c-5a24-49ae-bc37-b5f13309908c')
      )
    );
    assert.equal(new Set(again).size, 1);
    assert.equal((await list.getSammelCampaigns()).length, 2);
    assert.equal(
      (await SammelStaffCampaigns(request(input, 'POST', PRINCIPAL), context)).status,
      400
    );
  }
);

test('the common catalog stays within its size bound', () => {
  assert.throws(() =>
    validateSammelCatalog(
      Array(30).fill({
        name: 'Kluft',
        reference: '00123',
        variants: Array(40).fill('x'.repeat(120)),
      })
    )
  );
});

test('staff product prices require authentication and use the restricted shop lookup', async (t) => {
  const context = setup(t);
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        '<meta property="og:type" content="product"><meta property="og:title" content="Tent"><meta property="product:price" content="1002,00">',
        { headers: { 'content-type': 'text/html' } }
      )
  );
  const reference = 'https://www.ruesthaus.de/zelte/99801/test-tent';
  assert.equal((await SammelStaffProduct(request({ reference }, 'POST'), context)).status, 401);
  assert.equal(fetch.mock.callCount(), 0);
  const response = await SammelStaffProduct(request({ reference }, 'POST', PRINCIPAL), context);
  assert.equal(response.status, 200);
  assert.equal((response.jsonBody as { unitPriceCents: number }).unitPriceCents, 100200);
  assert.equal(
    (
      await SammelStaffProduct(
        request({ reference: 'https://evil.test/1/product' }, 'POST', PRINCIPAL),
        context
      )
    ).status,
    400
  );
  fetch.mock.mockImplementation(async () => {
    throw new Error('Shop unavailable');
  });
  assert.equal(
    (
      await SammelStaffProduct(
        request({ reference: reference.replace('99801', '99802') }, 'POST', PRINCIPAL),
        context
      )
    ).status,
    502
  );
});

dbTest(
  'member price lookup quota accommodates the catalog and order rows but remains bounded',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          '<meta property="og:type" content="product"><meta property="og:title" content="Catalog article"><meta property="product:price" content="12,50">',
          { headers: { 'content-type': 'text/html' } }
        )
    );
    const body = {
      id: '2',
      token: sammelToken('order', '2'),
      reference: 'https://www.ruesthaus.de/test/99781/catalog-quota',
    };
    for (let index = 0; index < 80; index++) {
      assert.equal((await SammelProductLookup(request(body), context)).status ?? 200, 200);
    }
    const limited = await SammelProductLookup(request(body), context);
    assert.equal(limited.status, 429);
    assert.equal((limited.jsonBody as { code: string }).code, 'LOOKUP_LIMIT');
    assert.equal(fetch.mock.callCount(), 1);
  }
);

dbTest(
  'Eschwege articles keep their supplier through validation, storage, mail and aggregation',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const eschwege = { ...ITEM, shop: 'eschwege' as const };
    assert.deepEqual(validateSammelItems([eschwege]), [eschwege]);
    const product = {
      ...ITEM,
      reference:
        'https://www.ausruester-eschwege.de/Cup::51561.html?MODsid=secret&action=add_product',
    };
    assert.deepEqual(validateSammelItems([product]), [
      {
        ...product,
        shop: 'eschwege',
        reference: 'https://www.ausruester-eschwege.de/Cup::51561.html',
      },
    ]);
    assert.throws(() => validateSammelItems([{ ...ITEM, shop: 'unknown' }]));
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    assert.equal(
      (
        await SammelOrderSave(
          request({ ...(await memberBody()), items: [ITEM, eschwege] }),
          context
        )
      ).status,
      200
    );
    assert.deepEqual(
      await getDb().selectFrom('sammel.order_item').select('shop').orderBy('position').execute(),
      [{ shop: 'ruesthaus' }, { shop: 'eschwege' }]
    );
    assert.match(String(send.mock.calls[0].arguments[2]), /Anbieter: Ausrüster Eschwege/);
    const view = (await SammelOrderLookup(request(await memberBody()), context)).jsonBody as {
      order: SammelBestellung;
    };
    assert.deepEqual(view.order.items, [ITEM, eschwege]);
    assert.equal(aggregateSammelItems([view.order]).length, 2);
  }
);

dbTest('staff exclusions remain stored, notify the family and reject stale edits', async (t) => {
  const context = setup(t);
  await seedSammel([sammelCampaign()], [sammelOrder({ totalCents: 500, paid: true })]);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const input = {
    etag: await orderVersion(),
    index: 0,
    excluded: true,
    reason: '<Nicht lieferbar>',
  };
  assert.equal((await SammelStaffItem(request(input, 'PATCH'), context)).status, 401);
  assert.equal(
    (await SammelStaffItem(request({ ...input, etag: '"old,1"' }, 'PATCH', PRINCIPAL), context))
      .status,
    409
  );
  const result = await SammelStaffItem(request(input, 'PATCH', PRINCIPAL), context);
  assert.equal(result.status, 200);
  const saved = await loadOrder();
  assert.deepEqual(saved.items[0].excluded, { reason: '<Nicht lieferbar>' });
  assert.equal(saved.totalCents, null);
  assert.equal(saved.paid, false);
  assert.equal(send.mock.calls.length, 1);
  assert.match(send.mock.calls[0].arguments[2]!, /&lt;Nicht lieferbar&gt;/);
  assert.deepEqual(aggregateSammelItems([saved]), []);
  assert.equal(sammelReceipt(saved.items, { '00123': 200 }).totalCents, 0);
  assert.equal((await SammelStaffItem(request(input, 'PATCH', PRINCIPAL), context)).status, 409);
  const again = await SammelStaffItem(
    request({ ...input, etag: saved.etag }, 'PATCH', PRINCIPAL),
    context
  );
  assert.equal((again.jsonBody as { code: string }).code, 'ITEM_ALREADY_UPDATED');
});

dbTest('member saves preserve staff exclusions and cannot change or forge them', async (t) => {
  const context = setup(t);
  const excluded = { ...ITEM, excluded: { reason: 'Nicht lieferbar' } };
  await seedSammel([sammelCampaign()], [sammelOrder({ items: [excluded] })]);
  const body = async (items: unknown[]): Promise<Record<string, unknown>> => ({
    ...(await memberBody()),
    name: 'Familie',
    items,
  });
  assert.equal((await SammelOrderSave(request(await body([ITEM])), context)).status, 200);
  assert.deepEqual((await loadOrder()).items, [excluded]);
  assert.equal(
    (await SammelOrderSave(request(await body([{ ...ITEM, quantity: 3 }])), context)).status,
    409
  );
  await getDb()
    .updateTable('sammel.order_item')
    .set({ excluded: false, excluded_reason: '' })
    .execute();
  assert.equal((await SammelOrderSave(request(await body([excluded])), context)).status, 200);
  assert.deepEqual((await loadOrder()).items, [ITEM]);
});

dbTest('failed exclusion notifications leave the saved item status intact', async (t) => {
  const context = setup(t);
  await seedSammel();
  t.mock.method(mail, 'sendMail', async () => {
    throw new Error('Mail unavailable');
  });
  const result = await SammelStaffItem(
    request(
      { etag: await orderVersion(), index: 0, excluded: true, reason: '' },
      'PATCH',
      PRINCIPAL
    ),
    context
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.jsonBody, { confirmationMailSent: false });
  assert.deepEqual((await loadOrder()).items[0].excluded, { reason: '' });
});

test('catalog validation retains the supplier of plain article numbers', () => {
  const article = { shop: 'eschwege', name: 'Juja', reference: '3020', variants: ['M'] };
  assert.deepEqual(validateSammelCatalog([article]), [article]);
  const campaign = validateSammelCampaign({
    title: 'Test',
    description: '',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-01T00:00:00.000Z',
    catalog: [article],
  });
  assert.deepEqual(campaign.catalog, [article]);
  assert.throws(() => validateSammelCatalog([{ ...article, shop: 'invalid' }]));
});

dbTest(
  'stock lookup keeps member and staff authentication and avoids external requests',
  async (t) => {
    const context = setup(t);
    await seedSammel();
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('Unexpected external request');
    });
    const reference = 'stamm-halstuch';
    assert.equal((await SammelStaffProduct(request({ reference }), context)).status, 401);
    const staff = await SammelStaffProduct(request({ reference }, 'POST', PRINCIPAL), context);
    assert.equal(staff.status, 200);
    assert.equal((staff.jsonBody as { unitPriceCents: number }).unitPriceCents, 2000);
    assert.equal(
      (await SammelProductLookup(request({ id: '2', token: 'invalid', reference }), context))
        .status,
      404
    );
    const member = await SammelProductLookup(
      request({ id: '2', token: sammelToken('order', '2'), reference }),
      context
    );
    assert.equal((member.jsonBody as { unitPriceCents: number }).unitPriceCents, 2000);
    assert.equal(fetch.mock.callCount(), 0);
  }
);

dbTest(
  'addresses that only the database collation equates get orders and links of their own',
  async (t) => {
    const context = setup(t);
    await seedSammel([sammelCampaign()], []);
    const send = t.mock.method(mail, 'sendMail', async () => undefined);
    const first = await ensureSammelOrder('1', 'familie@straße.de');
    const second = await ensureSammelOrder('1', 'familie@strasse.de');
    assert.notEqual(first.id, second.id);
    assert.equal(first.email, 'familie@straße.de');
    assert.equal(second.email, 'familie@strasse.de');
    assert.equal(await orderCount(), 2);
    await getDb().updateTable('sammel.member_order').set({ link_sent_at: null }).execute();
    await SammelRequestLink(request({ ...invitation(), email: 'familie@strasse.de' }), context);
    assert.equal(send.mock.callCount(), 1);
    assert.equal(send.mock.calls[0].arguments[0], 'familie@strasse.de');
    const html = String(send.mock.calls[0].arguments[2]);
    assert.ok(html.includes(sammelToken('order', second.id)));
    assert.ok(!html.includes(sammelToken('order', first.id)));
  }
);
