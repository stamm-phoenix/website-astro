import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest } from '@azure/functions';
import { aktionInStufeFeed, isStufeKey, STUFE_KEYS } from '../lib/aktion-stufen';
import * as aktionenList from '../lib/aktionen-list';
import { GetAktionenStufeIcsEndpoint } from '../endpoints/aktionen-stufe-ics';

function aktion(id: string, stufen: string[]): aktionenList.Aktion {
  return { id, title: `Aktion ${id}`, start: '2026-11-01', end: '2026-11-01', stufen };
}

test('a Stufe feed has the Aktionen of its Stufe and the ones without a Stufe', () => {
  assert.equal(aktionInStufeFeed(aktion('1', ['Wölflinge']), 'woelflinge'), true);
  assert.equal(aktionInStufeFeed(aktion('2', ['Wölflinge', 'Rover']), 'rover'), true);
  assert.equal(aktionInStufeFeed(aktion('3', ['Rover']), 'woelflinge'), false);
  assert.equal(aktionInStufeFeed(aktion('4', []), 'jupfis'), true);
  assert.equal(aktionInStufeFeed(aktion('5', ['Leitende']), 'pfadis'), false);
});

test('only the four Stufen are keys', () => {
  assert.deepEqual(Object.keys(STUFE_KEYS), ['woelflinge', 'jupfis', 'pfadis', 'rover']);
  assert.equal(isStufeKey('rover'), true);
  assert.equal(isStufeKey('leitende'), false);
  assert.equal(isStufeKey('toString'), false);
});

async function getFeed(
  t: test.TestContext,
  stufe: string
): Promise<Awaited<ReturnType<typeof GetAktionenStufeIcsEndpoint>>> {
  t.mock.method(aktionenList, 'getAktionen', async () => [
    aktion('wo', ['Wölflinge']),
    aktion('alle', []),
    aktion('rover', ['Rover']),
    aktion('leitende', ['Leitende']),
  ]);
  const request = new HttpRequest({
    url: `http://localhost/api/aktionen/${stufe}.ics`,
    method: 'GET',
    params: { stufe },
  });
  return GetAktionenStufeIcsEndpoint(request);
}

test('the feed of a Stufe is a calendar with the matching Aktionen', async (t) => {
  const response = await getFeed(t, 'woelflinge');
  assert.equal(response.status, 200);
  const body = String(response.body);
  assert.match(body, /X-WR-CALNAME:DPSG Stamm Phoenix - Wölflinge/);
  assert.match(body, /UID:wo@/);
  assert.match(body, /UID:alle@/);
  assert.doesNotMatch(body, /UID:rover@/);
  assert.doesNotMatch(body, /UID:leitende@/);
  assert.equal(
    (response.headers as Record<string, string>)['Content-Disposition'],
    'attachment; filename="aktionen-woelflinge.ics"'
  );
});

test('an unknown Stufe gives 404', async (t) => {
  const response = await getFeed(t, 'leitende');
  assert.equal(response.status, 404);
});
