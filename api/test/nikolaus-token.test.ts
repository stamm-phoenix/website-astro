import assert from 'node:assert/strict';
import test from 'node:test';
import { findBookingByToken } from '../lib/nikolaus-bookings';
import type { NikolausBooking } from '../lib/nikolaus-bookings';
import { hashToken, sameTokenHash, verifyToken } from '../lib/nikolaus-token';

function booking(id: string, token: string): NikolausBooking {
  return { id, tokenHash: token ? hashToken(token) : '' } as NikolausBooking;
}

test('the token of a polling request finds its booking among the loaded ones', async () => {
  const all = [booking('1', 'one'), booking('2', 'two'), booking('3', 'three'), booking('4', '')];
  const load = async (): Promise<NikolausBooking[]> => all;
  assert.equal((await findBookingByToken('two', load))?.id, '2');
  assert.equal((await findBookingByToken('three', load))?.id, '3');
  assert.equal(await findBookingByToken('four', load), undefined);
});

test('an empty token never matches, not even a booking without a hash', async () => {
  const load = async (): Promise<NikolausBooking[]> => [booking('1', ''), booking('2', 'two')];
  assert.equal(await findBookingByToken('', load), undefined);
});

test('hashes compare as equals only when they are the same SHA-256', () => {
  const hash = hashToken('secret');
  assert.equal(hash.length, 64);
  assert.equal(sameTokenHash(hash, hashToken('secret')), true);
  assert.equal(sameTokenHash(hash, hashToken('Secret')), false);
  assert.equal(sameTokenHash(hash, hash.slice(0, 62)), false);
  assert.equal(sameTokenHash('', ''), false);
  assert.equal(verifyToken({ tokenHash: hash }, 'secret'), true);
  assert.equal(verifyToken({ tokenHash: hash }, 'other'), false);
  assert.equal(verifyToken({ tokenHash: hash }, ''), false);
});
