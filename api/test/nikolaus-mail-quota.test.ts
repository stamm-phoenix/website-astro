import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as bookings from '../lib/nikolaus-bookings';
import * as mails from '../lib/nikolaus-mails';
import * as graphMail from '../lib/mail';
import * as sharePoint from '../lib/sharepoint-data-access';
import { consumeNikolausMailPermit, reserveNikolausMailQuota } from '../lib/nikolaus-mail-quota';
import { readNikolausState } from '../lib/nikolaus-state';
import { NIKOLAUS_CONFIG, getNikolausSlots } from '../lib/nikolaus-config';
import CreateNikolausBookingEndpoint from '../endpoints/nikolaus-booking-create';
import ResendNikolausLinkEndpoint from '../endpoints/nikolaus-manage-resend-link';
import { setupSharedState } from './fixtures/shared-state';

const NOW = Date.parse('2026-12-01T12:00:00Z');
const KEY = `mailquota:${createHash('sha256').update('sender@example.test').digest('hex')}`;

interface QuotaState {
  hour: number;
  hourCount: number;
  day: number;
  dayCount: number;
}

function exhausted(): QuotaState {
  return {
    hour: Math.floor(NOW / 3_600_000),
    hourCount: 100,
    day: Math.floor(NOW / 86_400_000),
    dayCount: 100,
  };
}

test('parallel instances share the last sender permit and permits cannot be reused', async (t) => {
  setupSharedState(t).seed(KEY, { ...exhausted(), hourCount: 99 });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => reserveNikolausMailQuota(undefined, NOW))
  );
  const allowed = results.filter((permit) => permit !== undefined);
  assert.equal(allowed.length, 1);
  assert.equal(consumeNikolausMailPermit(allowed[0]), true);
  assert.equal(consumeNikolausMailPermit(allowed[0]), false);
  const quota = (await readNikolausState(KEY))?.data as QuotaState;
  assert.equal(quota.hourCount, 100);
});

test('hour and day boundaries reset independently and failed attempts are not refunded', async (t) => {
  setupSharedState(t).seed(KEY, { ...exhausted(), dayCount: 499 });
  assert.equal(await reserveNikolausMailQuota(undefined, NOW + 3_599_999), undefined);
  assert.ok(await reserveNikolausMailQuota(undefined, NOW + 3_600_000));
  assert.equal(await reserveNikolausMailQuota(undefined, NOW + 7_200_000), undefined);
  assert.ok(await reserveNikolausMailQuota(undefined, NOW + 86_400_000));
});

test('corrupt counters never reopen an active quota', async (t) => {
  setupSharedState(t).seed(KEY, { ...exhausted(), hourCount: -1 });
  await assert.rejects(reserveNikolausMailQuota(undefined, NOW), /Invalid stored Nikolaus state/);
});

test('pre-admitted mail consumes one permit and new links never contain query credentials', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  setupSharedState(t).seed(KEY, { ...exhausted(), hourCount: 99 });
  const permit = await reserveNikolausMailQuota(undefined, NOW);
  assert.ok(permit);
  const delivered: string[] = [];
  t.mock.method(graphMail, 'sendMail', async (_to: string, _subject: string, html: string) => {
    delivered.push(html);
  });
  const data = {
    familyName: 'Testfamilie',
    email: 'family@example.test',
    phone: '0123456789',
    street: 'Teststraße 1',
    postalCode: '83620',
    city: 'Testort',
    addressNotes: '',
    childrenCount: 2,
    withKrampus: false,
    hidingPlace: 'Tür',
    notes: '',
    slot: getNikolausSlots()[0],
    token: 'simulated-token-for-fragment-links',
    siteUrl: 'http://localhost',
    mailPermit: permit,
  };
  await mails.sendConfirmationRequestMail(data, 120);
  assert.equal(delivered.length, 1);
  assert.ok(delivered[0].includes('/nikolaus/termin#token=simulated-token-for-fragment-links'));
  assert.equal(delivered[0].includes('/nikolaus/termin?token='), false);
  await assert.rejects(mails.sendManageLinkMail(data), /Mailversand ist vorübergehend begrenzt/);
  await assert.rejects(
    mails.sendBookingConfirmedMail(data),
    /Mailversand ist vorübergehend begrenzt/
  );
  assert.equal(delivered.length, 1);
});

test('quota exhaustion prevents creating a booking and sending any confirmation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  setupSharedState(t).seed(KEY, exhausted());
  const active = NIKOLAUS_CONFIG.publicActive;
  NIKOLAUS_CONFIG.publicActive = true;
  t.after(() => {
    NIKOLAUS_CONFIG.publicActive = active;
  });
  const create = t.mock.method(bookings, 'createBooking', async () => {
    throw new Error('Must not create');
  });
  const send = t.mock.method(mails, 'sendConfirmationRequestMail', async () => undefined);
  const request = new HttpRequest({
    method: 'POST',
    url: 'http://localhost/api/nikolaus/bookings',
    body: {
      string: JSON.stringify({
        familyName: 'Testfamilie',
        email: 'family@example.test',
        phone: '0123456789',
        street: 'Teststraße 1',
        postalCode: '83620',
        city: 'Testort',
        addressNotes: '',
        childrenCount: 2,
        withKrampus: false,
        hidingPlace: 'Tür',
        notes: '',
        slot: getNikolausSlots()[0].key,
      }),
    },
  });
  const response = await CreateNikolausBookingEndpoint(request, new InvocationContext());
  assert.equal(response.status, 429);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});

test('global resend rejection does not reveal whether an address has a booking', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  setupSharedState(t).seed(KEY, exhausted());
  const find = t.mock.method(bookings, 'findActiveBookingByEmail', async () => undefined);
  const send = t.mock.method(mails, 'sendManageLinkMail', async () => undefined);
  for (const email of ['existing@example.test', 'absent@example.test']) {
    const request = new HttpRequest({
      method: 'POST',
      url: 'http://localhost/api/nikolaus/manage/resend-link',
      body: { string: JSON.stringify({ email }) },
    });
    assert.equal((await ResendNikolausLinkEndpoint(request, new InvocationContext())).status, 429);
  }
  assert.equal(find.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});

test('unavailable shared state fails closed before booking creation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  setupSharedState(t);
  t.mock.method(sharePoint, 'getSharePointListItems', async () => {
    throw new Error('Simulated shared storage outage');
  });
  const find = t.mock.method(bookings, 'findActiveBookingByEmail', async () => undefined);
  const send = t.mock.method(mails, 'sendManageLinkMail', async () => undefined);
  const request = new HttpRequest({
    method: 'POST',
    url: 'http://localhost/api/nikolaus/manage/resend-link',
    body: { string: JSON.stringify({ email: 'family@example.test' }) },
  });
  const response = await ResendNikolausLinkEndpoint(request, new InvocationContext());
  assert.equal(response.status, 503);
  assert.equal(find.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
});
