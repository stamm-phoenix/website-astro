import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as graph from '../lib/sharepoint-data-access';
import { CONFIG } from '../lib/config';
import * as env from '../lib/environment';
import * as mail from '../lib/mail';
import { overrideConfig } from './fixtures/config';
import { reserveSammelLinkRequest } from '../lib/sammelbestellung-link-quota';
import {
  sammelToken,
  ensureSammelOrder,
  createSammelCampaign,
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

const VERSION = '"item,1"';
const ITEM = { name: 'Kluft', reference: '00123', variant: '164', quantity: 2 };
const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};
const CAMPAIGN = {
  id: '1',
  eTag: VERSION,
  fields: {
    Title: 'Frühjahr',
    Beschreibung: 'Gemeinsam bestellen',
    Beginn: '2020-01-01T00:00:00.000Z',
    Ende: '2099-01-01T00:00:00.000Z',
    Katalog: '[]',
  },
};
const ORDER = {
  id: '2',
  eTag: VERSION,
  fields: {
    Title: 'Familie Test',
    Email: 'family@example.test',
    AktionId: '1',
    Artikel: JSON.stringify([ITEM]),
    Status: 'Eingereicht',
    Eingereicht: true,
    Bezahlt: false,
    Ausgeliefert: false,
    Bemerkungen: '',
  },
};

function setup(t: TestContext): InvocationContext {
  t.mock.method(env, 'getEnvironment', (name: env.EnvironmentVariable) => {
    if (name === env.EnvironmentVariable.SAMMELBESTELLUNG_LINK_SECRET)
      return 'test-secret-with-more-than-thirty-two-characters';
    throw new Error(`Unexpected environment variable: ${name}`);
  });
  overrideConfig(t, CONFIG.sharepoint.lists, {
    sammelbestellungen: 'campaigns',
    sammelbestellungenOrders: 'orders',
  });
  t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
    list === 'campaigns' ? structuredClone(CAMPAIGN) : structuredClone(ORDER)
  );
  t.mock.method(graph, 'getSharePointListItems', async (list: string) =>
    list === 'campaigns' ? [structuredClone(CAMPAIGN)] : [structuredClone(ORDER)]
  );
  t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  t.mock.method(graph, 'createSharePointListItem', async () => '2');
  t.mock.method(mail, 'sendMail', async () => undefined);
  const context = new InvocationContext({ functionName: 'sammel-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}
function request(body: unknown, method = 'POST', principal?: unknown): HttpRequest {
  return new HttpRequest({
    url: 'https://example.test/api/sammelbestellungen',
    method,
    headers: {
      'content-type': 'application/json',
      ...(principal
        ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') }
        : {}),
    },
    params: { id: '2' },
    body: method === 'GET' ? undefined : { string: JSON.stringify(body) },
  });
}

const memberBody = (): Record<string, unknown> => ({
  id: '2',
  token: sammelToken('order', '2'),
  etag: VERSION,
  name: 'Familie Test',
  notes: '',
  items: [ITEM],
});
const invitation = (): Record<string, unknown> => ({
  id: '1',
  token: sammelToken('campaign', '1'),
  email: ' FAMILY@EXAMPLE.TEST ',
});

test('corrupt stored catalog, articles and status identify the row and field without hiding items', async (t) => {
  const context = setup(t);
  for (const field of ['Katalog', 'Artikel', 'Status']) {
    for (const value of [undefined, '', '{', '{}', 'null', '[{}]']) {
      t.mock.method(graph, 'getSharePointListItem', async (list: string) => {
        const row = structuredClone(list === 'campaigns' ? CAMPAIGN : ORDER);
        if ((field === 'Katalog') === (list === 'campaigns'))
          Object.assign(row.fields, { [field]: value });
        return row;
      });
      t.mock.method(graph, 'getSharePointListItems', async (list: string) => {
        const row = structuredClone(list === 'campaigns' ? CAMPAIGN : ORDER);
        if ((field === 'Katalog') === (list === 'campaigns'))
          Object.assign(row.fields, { [field]: value });
        return [row];
      });
      for (const endpoint of [SammelOrderLookup, SammelStaffCampaign]) {
        const result = await endpoint(
          endpoint === SammelOrderLookup ? request(memberBody()) : request({}, 'GET', PRINCIPAL),
          context
        );
        assert.equal(result.status, 503);
        const body = result.jsonBody as { code: string; message: string };
        assert.equal(body.code, 'INVALID_STORED_DATA');
        assert.match(body.message, new RegExp(`Eintrag ${field === 'Katalog' ? '1' : '2'}:`));
        assert.match(body.message, new RegExp(field));
      }
      if (field === 'Katalog')
        assert.equal(
          (await SammelStaffCampaigns(request({}, 'GET', PRINCIPAL), context)).status,
          503
        );
    }
  }
});

test('only unsubmitted orders may contain an explicitly empty stored article array', async (t) => {
  const context = setup(t);
  for (const submitted of [false, true]) {
    t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
      list === 'campaigns'
        ? structuredClone(CAMPAIGN)
        : {
            ...structuredClone(ORDER),
            fields: { ...ORDER.fields, Artikel: '[]', Eingereicht: submitted },
          }
    );
    const result = await SammelOrderLookup(request(memberBody()), context);
    assert.equal(result.status ?? 200, submitted ? 503 : 200);
  }
});

test('staff routes reject anonymous users, other providers and foreign tenant claims before reading data', async (t) => {
  const context = setup(t);
  const read = t.mock.method(graph, 'getSharePointListItem', async () => undefined);
  const reads = t.mock.method(graph, 'getSharePointListItems', async () => []);
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
  assert.equal(read.mock.callCount(), 0);
  assert.equal(reads.mock.callCount(), 0);
});

test('campaign tokens cannot read orders and forged or malformed tokens never load personal data', async (t) => {
  const context = setup(t);
  const read = t.mock.method(graph, 'getSharePointListItem', async () => undefined);
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
  assert.equal(read.mock.callCount(), 0);
  assert.equal(verifySammelToken('order', '2', sammelToken('order', '2')), true);
  assert.equal(verifySammelToken('campaign', '2', sammelToken('order', '2')), false);
});

test('member views expose only one order and remain readable after the deadline', async (t) => {
  const context = setup(t);
  t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
    list === 'campaigns'
      ? { ...CAMPAIGN, fields: { ...CAMPAIGN.fields, Ende: '2021-01-01T00:00:00.000Z' } }
      : { ...ORDER, fields: { ...ORDER.fields, LinkGesendetAm: 'private-metadata' } }
  );
  const response = await SammelOrderLookup(request(memberBody()), context);
  const body = response.jsonBody as { order: Record<string, unknown>; canEdit: boolean };
  assert.equal(body.canEdit, false);
  assert.equal(body.order.email, ORDER.fields.Email);
  assert.equal('linkSentAt' in body.order, false);
  assert.equal('token' in body.order, false);
});

test('campaign invitations and member writes reject closed periods and processing states', async (t) => {
  const context = setup(t);
  const write = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  const read = t.mock.method(graph, 'getSharePointListItem', async () => undefined);
  for (const dates of [
    { Beginn: '2098-01-01T00:00:00.000Z', Ende: '2099-01-01T00:00:00.000Z' },
    { Beginn: '2020-01-01T00:00:00.000Z', Ende: '2021-01-01T00:00:00.000Z' },
  ]) {
    read.mock.mockImplementation(async (list: string) =>
      list === 'campaigns' ? { ...CAMPAIGN, fields: { ...CAMPAIGN.fields, ...dates } } : ORDER
    );
    assert.equal((await SammelOrderSave(request(memberBody()), context)).status, 403);
    assert.equal((await SammelCampaignLookup(request(invitation()), context)).status, 403);
    assert.equal((await SammelRequestLink(request(invitation()), context)).status, 403);
  }
  for (const status of ['Bestellt', 'Eingetroffen', 'Storniert']) {
    read.mock.mockImplementation(async (list: string) =>
      list === 'campaigns' ? CAMPAIGN : { ...ORDER, fields: { ...ORDER.fields, Status: status } }
    );
    assert.equal((await SammelOrderSave(request(memberBody()), context)).status, 403);
  }
  assert.equal(write.mock.callCount(), 0);
});

test('member edits use the loaded version, reset a previous price and ignore privileged fields', async (t) => {
  const context = setup(t);
  const write = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  assert.equal(
    (
      await SammelOrderSave(
        request({
          ...memberBody(),
          email: 'attacker@example.test',
          paid: true,
          status: 'Bestellt',
          totalCents: 1,
        }),
        context
      )
    ).status,
    200
  );
  assert.deepEqual(write.mock.calls[0].arguments, [
    'orders',
    '2',
    {
      Title: 'Familie Test',
      Artikel: JSON.stringify([ITEM]),
      Bemerkungen: '',
      Eingereicht: true,
      BetragCent: null,
      Bezahlt: false,
    },
    VERSION,
  ]);
  for (const etag of ['', '*', '"stale,1"', undefined]) {
    const response = await SammelOrderSave(request({ ...memberBody(), etag }), context);
    assert.ok(response.status === 400 || response.status === 409);
  }
  assert.equal(write.mock.callCount(), 1);
  write.mock.mockImplementation(async () => {
    throw { statusCode: 412 };
  });
  assert.equal((await SammelOrderSave(request(memberBody()), context)).status, 409);
});

test('staff can lock orders, set the final amount and check payment/delivery with concurrency protection', async (t) => {
  const context = setup(t);
  const write = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  const body = {
    etag: VERSION,
    status: 'Eingetroffen',
    paid: true,
    delivered: true,
    totalCents: 12345,
  };
  assert.equal((await SammelStaffOrder(request(body, 'PATCH', PRINCIPAL), context)).status, 204);
  assert.deepEqual(write.mock.calls[0].arguments, [
    'orders',
    '2',
    { Status: 'Eingetroffen', Bezahlt: true, Ausgeliefert: true, BetragCent: 12345 },
    VERSION,
  ]);
  assert.equal(
    (await SammelStaffOrder(request({ ...body, etag: '"old,1"' }, 'PATCH', PRINCIPAL), context))
      .status,
    409
  );
  assert.equal(
    (await SammelStaffOrder(request({ ...body, status: 'Bestellt' }, 'PATCH', PRINCIPAL), context))
      .status,
    400
  );
  assert.equal(write.mock.callCount(), 1);
});

test('staff can archive and restore campaigns with the loaded version', async (t) => {
  const context = setup(t);
  const write = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  for (const archived of [true, false]) {
    const response = await SammelStaffCampaign(
      request({ etag: VERSION, archived }, 'PATCH', PRINCIPAL),
      context
    );
    assert.equal(response.status, 204);
    assert.deepEqual(write.mock.calls.at(-1)?.arguments, [
      'campaigns',
      '1',
      { Archiviert: archived },
      VERSION,
    ]);
  }
  assert.equal(
    (
      await SammelStaffCampaign(
        request({ etag: '"old,1"', archived: true }, 'PATCH', PRINCIPAL),
        context
      )
    ).status,
    409
  );
  assert.equal(
    (
      await SammelStaffCampaign(
        request({ etag: VERSION, archived: 'true' }, 'PATCH', PRINCIPAL),
        context
      )
    ).status,
    400
  );
  assert.equal(write.mock.callCount(), 2);
});

test('archived campaigns reject invitations and member writes but retain personal order views', async (t) => {
  const context = setup(t);
  t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
    list === 'campaigns' ? { ...CAMPAIGN, fields: { ...CAMPAIGN.fields, Archiviert: true } } : ORDER
  );
  assert.equal((await SammelCampaignLookup(request(invitation()), context)).status, 403);
  assert.equal((await SammelRequestLink(request(invitation()), context)).status, 403);
  assert.equal((await SammelOrderSave(request(memberBody()), context)).status, 403);
  assert.equal(
    (
      await SammelProductLookup(
        request({ ...memberBody(), reference: 'https://www.ruesthaus.de/1/test' }),
        context
      )
    ).status,
    403
  );
  const response = await SammelOrderLookup(request(memberBody()), context);
  const view = response.jsonBody as { canEdit: boolean; campaign: SammelAktion };
  assert.equal(view.canEdit, false);
  assert.equal(view.campaign.archived, true);
});

test('successful submissions and edits mail the saved contents to the stored recipient', async (t) => {
  const context = setup(t);
  let submitted = false;
  t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
    list === 'campaigns'
      ? structuredClone(CAMPAIGN)
      : {
          ...structuredClone(ORDER),
          fields: { ...ORDER.fields, Eingereicht: submitted },
        }
  );
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const body = {
    ...memberBody(),
    name: '<Familie & Test>',
    notes: 'Erste Zeile\n<zweite>',
    email: 'attacker@example.test',
  };
  const first = await SammelOrderSave(request(body), context);
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
  submitted = true;
  await SammelOrderSave(request({ ...body, items: [{ ...ITEM, quantity: 3 }] }), context);
  assert.equal(send.mock.callCount(), 2);
  assert.match(String(send.mock.calls[1].arguments[1]), /Bestellung aktualisiert/);
  assert.match(String(send.mock.calls[1].arguments[2]), /3 × Kluft/);
});

test('confirmation mail failure reports a saved order without repeating the write', async (t) => {
  const context = setup(t);
  const write = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  t.mock.method(mail, 'sendMail', async () => {
    throw new Error('Mail unavailable');
  });
  const response = await SammelOrderSave(request(memberBody()), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { confirmationMailSent: false });
  assert.equal(write.mock.callCount(), 1);
});

test('stale versions and failed writes never send a confirmation mail', async (t) => {
  const context = setup(t);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  assert.equal(
    (await SammelOrderSave(request({ ...memberBody(), etag: '"old,1"' }), context)).status,
    409
  );
  t.mock.method(graph, 'updateSharePointListItem', async () => {
    throw { statusCode: 412 };
  });
  assert.equal((await SammelOrderSave(request(memberBody()), context)).status, 409);
  assert.equal(send.mock.callCount(), 0);
});

test('staff messages use the stored recipient, sanitize formatting and sign with the acting user', async (t) => {
  const context = setup(t);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const write = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  const response = await SammelStaffMessage(
    request(
      {
        etag: VERSION,
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
  assert.equal(write.mock.callCount(), 0);
});

test('staff messages reject stale versions and invalid messages and report mail failures', async (t) => {
  const context = setup(t);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const body = { etag: VERSION, subject: 'Abholung', message: '<p>Bitte abholen.</p>' };
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
});

test('repeated link requests adopt the same order and mail only a personal fragment link', async (t) => {
  const context = setup(t);
  const create = t.mock.method(graph, 'createSharePointListItem', async () => '2');
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  await SammelRequestLink(request(invitation()), context);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 1);
  assert.equal(send.mock.calls[0].arguments[0], 'family@example.test');
  const html = String(send.mock.calls[0].arguments[2]);
  assert.ok(html.includes('/mitgliederbereich/sammelbestellungen#kind=order'));
  assert.ok(html.includes(sammelToken('order', '2')));
  assert.ok(!html.includes(sammelToken('campaign', '1')));
  t.mock.method(graph, 'getSharePointListItems', async () => [
    { ...ORDER, fields: { ...ORDER.fields, LinkGesendetAm: new Date().toISOString() } },
  ]);
  await SammelRequestLink(request(invitation()), context);
  await SammelRequestLink(request({ ...invitation(), website: 'bot.test' }), context);
  assert.equal(send.mock.callCount(), 1);
});

test('a unique-key race adopts the existing order, never inserts a second logical order', async (t) => {
  setup(t);
  let reads = 0;
  t.mock.method(graph, 'getSharePointListItems', async () => (++reads === 1 ? [] : [ORDER]));
  t.mock.method(graph, 'createSharePointListItem', async () => {
    throw { statusCode: 400 };
  });
  assert.equal((await ensureSammelOrder('1', 'family@example.test')).id, '2');
});

test('mail failure clears the cooldown using the latest ETag without invalidating existing links', async (t) => {
  const context = setup(t);
  let reserved = '';
  const write = t.mock.method(
    graph,
    'updateSharePointListItem',
    async (_list: string, _id: string, values: Record<string, unknown>) => {
      reserved = String(values.LinkGesendetAm ?? '');
    }
  );
  t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
    list === 'campaigns'
      ? CAMPAIGN
      : {
          ...ORDER,
          eTag: reserved ? '"item,2"' : VERSION,
          fields: { ...ORDER.fields, LinkGesendetAm: reserved },
        }
  );
  t.mock.method(mail, 'sendMail', async () => {
    throw new Error('mail unavailable');
  });
  const before = sammelToken('order', '2');
  assert.equal((await SammelRequestLink(request(invitation()), context)).status, 502);
  assert.equal(write.mock.callCount(), 3);
  assert.deepEqual(write.mock.calls[2].arguments, [
    'orders',
    '2',
    { LinkGesendetAm: '' },
    '"item,2"',
  ]);
  assert.equal(sammelToken('order', '2'), before);
});

test('concurrent cooldown reservation sends no additional mail and upstream failures stay private', async (t) => {
  const context = setup(t);
  t.mock.method(graph, 'updateSharePointListItem', async (list: string) => {
    if (list === 'orders') throw { statusCode: 412 };
  });
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  assert.equal((await SammelRequestLink(request(invitation()), context)).jsonBody.sent, true);
  assert.equal(send.mock.callCount(), 0);
  t.mock.method(graph, 'getSharePointListItem', async () => {
    throw new Error('private Graph credentials');
  });
  const response = await SammelOrderLookup(request(memberBody()), context);
  assert.equal(response.status, 500);
  assert.ok(!JSON.stringify(response.jsonBody).includes('credentials'));
  assert.equal((response.headers as Record<string, string>)['Cache-Control'], 'no-store');
});

test('campaign link quotas stop varying recipients before order creation or mail delivery', async (t) => {
  const context = setup(t);
  const hour = Math.floor(Date.now() / 3_600_000);
  const day = Math.floor(Date.now() / 86_400_000);
  const create = t.mock.method(graph, 'createSharePointListItem', async () => '2');
  const readOrders = t.mock.method(graph, 'getSharePointListItems', async () => []);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  for (const quota of [
    { hour, hourCount: 100, day, dayCount: 100 },
    { hour, hourCount: 0, day, dayCount: 500 },
  ]) {
    t.mock.method(graph, 'getSharePointListItem', async () => ({
      ...CAMPAIGN,
      fields: { ...CAMPAIGN.fields, LinkversandLimit: JSON.stringify(quota) },
    }));
    for (const address of ['first@example.test', 'second@example.test']) {
      const result = await SammelRequestLink(request({ ...invitation(), email: address }), context);
      assert.equal(result.status, 429);
      assert.equal(result.jsonBody.code, 'LINK_LIMIT');
    }
  }
  assert.equal(create.mock.callCount(), 0);
  assert.equal(readOrders.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});

test('persistent link quotas retry conflicts, retain daily counts and reset expired windows', async (t) => {
  setup(t);
  const now = Date.UTC(2026, 9, 1, 12);
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  let row = {
    ...CAMPAIGN,
    fields: {
      ...CAMPAIGN.fields,
      LinkversandLimit: JSON.stringify({
        hour: hour - 1,
        hourCount: 100,
        day,
        dayCount: 499,
      }),
    },
  };
  t.mock.method(graph, 'getSharePointListItem', async () => structuredClone(row));
  let conflict = true;
  const write = t.mock.method(
    graph,
    'updateSharePointListItem',
    async (_list: string, _id: string, fields: Record<string, unknown>, etag: string) => {
      assert.notEqual(etag, '*');
      if (conflict) {
        conflict = false;
        row.eTag = '"new,2"';
        throw { statusCode: 412 };
      }
      row = {
        ...row,
        fields: { ...row.fields, LinkversandLimit: String(fields.LinkversandLimit) },
      };
    }
  );
  assert.equal(await reserveSammelLinkRequest('1', now), true);
  assert.equal(write.mock.callCount(), 2);
  assert.deepEqual(JSON.parse(row.fields.LinkversandLimit), {
    hour,
    hourCount: 1,
    day,
    dayCount: 500,
  });
  assert.equal(await reserveSammelLinkRequest('1', now), false);
  assert.equal(await reserveSammelLinkRequest('1', now + 86_400_000), true);
  assert.deepEqual(JSON.parse(row.fields.LinkversandLimit), {
    hour: hour + 24,
    hourCount: 1,
    day: day + 1,
    dayCount: 1,
  });
});

test('link quota corruption and sustained concurrent contention fail closed', async (t) => {
  const context = setup(t);
  t.mock.method(graph, 'getSharePointListItem', async () => ({
    ...CAMPAIGN,
    fields: { ...CAMPAIGN.fields, LinkversandLimit: '{}' },
  }));
  assert.equal((await SammelRequestLink(request(invitation()), context)).status, 503);
  t.mock.method(graph, 'getSharePointListItem', async () => CAMPAIGN);
  t.mock.method(graph, 'updateSharePointListItem', async () => {
    throw { statusCode: 412 };
  });
  const result = await SammelRequestLink(request(invitation()), context);
  assert.equal(result.status, 429);
});

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

test('campaign creation validates the catalog and stores a retry key, then adopts a previous creation', async (t) => {
  const context = setup(t);
  const creationKey = 'b0a8c20c-5a24-49ae-bc37-b5f13309908c';
  const input = {
    title: 'Sommer',
    description: '',
    startsAt: CAMPAIGN.fields.Beginn,
    endsAt: CAMPAIGN.fields.Ende,
    catalog: [{ name: ITEM.name, reference: ITEM.reference, variants: ['164'] }],
    archived: false,
  };
  const reads = t.mock.method(graph, 'getSharePointListItems', async () => []);
  const create = t.mock.method(graph, 'createSharePointListItem', async () => '3');
  assert.equal(
    (await SammelStaffCampaigns(request({ ...input, creationKey }, 'POST', PRINCIPAL), context))
      .status,
    201
  );
  assert.deepEqual(create.mock.calls[0].arguments, [
    'campaigns',
    {
      CreationKey: creationKey,
      Title: input.title,
      Beschreibung: '',
      Beginn: input.startsAt,
      Ende: input.endsAt,
      Katalog: JSON.stringify(input.catalog),
      Archiviert: false,
    },
  ]);
  reads.mock.mockImplementation(async () => [{ ...CAMPAIGN, id: '3' }]);
  assert.equal(await createSammelCampaign(input, creationKey), '3');
  assert.equal(create.mock.callCount(), 1);
  assert.equal(
    (await SammelStaffCampaigns(request(input, 'POST', PRINCIPAL), context)).status,
    400
  );
});

test('the common catalog fits in a plain-text SharePoint column', () => {
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

test('member price lookup quota accommodates the catalog and order rows but remains bounded', async (t) => {
  const context = setup(t);
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
});

test('malformed SharePoint rows report stored-data errors instead of blaming submitted input', async (t) => {
  const context = setup(t);
  for (const raw of [
    null,
    [],
    {},
    { id: 'invalid', fields: {} },
    { id: '1' },
    { id: '1', fields: [] },
    { id: '1', fields: 'invalid' },
  ]) {
    t.mock.method(graph, 'getSharePointListItems', async () => [raw]);
    const response = await SammelStaffCampaigns(request({}, 'GET', PRINCIPAL), context);
    assert.equal(response.status, 503);
    assert.equal((response.jsonBody as { code: string }).code, 'INVALID_STORED_DATA');
  }
});

test('Eschwege articles keep their supplier through validation, storage, mail and aggregation', async (t) => {
  const context = setup(t);
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
  const write = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  assert.equal(
    (await SammelOrderSave(request({ ...memberBody(), items: [ITEM, eschwege] }), context)).status,
    200
  );
  assert.match(JSON.stringify(write.mock.calls[0].arguments), /eschwege/);
  assert.match(String(send.mock.calls[0].arguments[2]), /Anbieter: Ausrüster Eschwege/);
  const view = (await SammelOrderLookup(request(memberBody()), context)).jsonBody as {
    order: SammelBestellung;
  };
  assert.equal(
    aggregateSammelItems([{ ...view.order, submitted: true, items: [ITEM, eschwege] }]).length,
    2
  );
});

test('staff exclusions remain stored, notify the family and reject stale edits', async (t) => {
  const context = setup(t);
  const update = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const input = { etag: VERSION, index: 0, excluded: true, reason: '<Nicht lieferbar>' };
  assert.equal((await SammelStaffItem(request(input, 'PATCH'), context)).status, 401);
  assert.equal(
    (await SammelStaffItem(request({ ...input, etag: '"old,1"' }, 'PATCH', PRINCIPAL), context))
      .status,
    409
  );
  const result = await SammelStaffItem(request(input, 'PATCH', PRINCIPAL), context);
  assert.equal(result.status, 200);
  const fields = update.mock.calls[0].arguments[2]!;
  const items = JSON.parse(String(fields.Artikel));
  assert.deepEqual(items[0].excluded, { reason: '<Nicht lieferbar>' });
  assert.equal(fields.BetragCent, null);
  assert.equal(fields.Bezahlt, false);
  assert.equal(send.mock.calls.length, 1);
  assert.match(send.mock.calls[0].arguments[2]!, /&lt;Nicht lieferbar&gt;/);
  assert.deepEqual(
    aggregateSammelItems([
      { id: '2', submitted: true, status: 'Eingereicht', items } as SammelBestellung,
    ]),
    []
  );
  assert.equal(sammelReceipt(items, { '00123': 200 }).totalCents, 0);
});

test('member saves preserve staff exclusions and cannot change or forge them', async (t) => {
  const context = setup(t);
  const excluded = { ...ITEM, excluded: { reason: 'Nicht lieferbar' } };
  t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
    list === 'campaigns'
      ? structuredClone(CAMPAIGN)
      : {
          ...structuredClone(ORDER),
          fields: { ...ORDER.fields, Artikel: JSON.stringify([excluded]) },
        }
  );
  const update = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  const body = {
    id: '2',
    token: sammelToken('order', '2'),
    etag: VERSION,
    name: 'Familie',
    notes: '',
    items: [ITEM],
  };
  assert.equal((await SammelOrderSave(request(body), context)).status, 200);
  assert.deepEqual(JSON.parse(String(update.mock.calls[0].arguments[2]!.Artikel)), [excluded]);
  assert.equal(
    (await SammelOrderSave(request({ ...body, items: [{ ...ITEM, quantity: 3 }] }), context))
      .status,
    409
  );
  t.mock.method(graph, 'getSharePointListItem', async (list: string) =>
    list === 'campaigns' ? structuredClone(CAMPAIGN) : structuredClone(ORDER)
  );
  assert.equal(
    (await SammelOrderSave(request({ ...body, items: [excluded] }), context)).status,
    200
  );
  assert.deepEqual(JSON.parse(String(update.mock.calls.at(-1)!.arguments[2]!.Artikel)), [ITEM]);
});

test('failed exclusion notifications leave the saved item status intact', async (t) => {
  const context = setup(t);
  const update = t.mock.method(graph, 'updateSharePointListItem', async () => undefined);
  t.mock.method(mail, 'sendMail', async () => {
    throw new Error('Mail unavailable');
  });
  const result = await SammelStaffItem(
    request({ etag: VERSION, index: 0, excluded: true, reason: '' }, 'PATCH', PRINCIPAL),
    context
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.jsonBody, { confirmationMailSent: false });
  assert.equal(update.mock.calls.length, 1);
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

test('stock lookup keeps member and staff authentication and avoids external requests', async (t) => {
  const context = setup(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected external request');
  });
  const reference = 'stamm-halstuch';
  assert.equal((await SammelStaffProduct(request({ reference }), context)).status, 401);
  const staff = await SammelStaffProduct(request({ reference }, 'POST', PRINCIPAL), context);
  assert.equal(staff.status, 200);
  assert.equal((staff.jsonBody as { unitPriceCents: number }).unitPriceCents, 2000);
  assert.equal(
    (await SammelProductLookup(request({ id: '1', token: 'invalid', reference }), context)).status,
    404
  );
  const member = await SammelProductLookup(
    request({ id: '1', token: sammelToken('order', '1'), reference }),
    context
  );
  assert.equal((member.jsonBody as { unitPriceCents: number }).unitPriceCents, 2000);
  assert.equal(fetch.mock.callCount(), 0);
});
