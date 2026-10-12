import assert from 'node:assert/strict';
import test from 'node:test';
import {
  taggedTaskAssignee,
  taskAssigneeLogin,
  taskAssignedToLogin,
} from '../lib/aufgaben-zuordnung';
import { getSharePointSiteUsers } from '../lib/sharepoint-rest';
import * as token from '../lib/token';
import { CONFIG } from '../lib/config';

const users = [{ name: 'Mara Bertram', login: 'mara@example.test' }];

test('explicit tagged responsibility resolves to a real login, preserving ambiguous names', () => {
  const task = { assignee: 'Mara Bertram', quote: 'Öffis @Mara Bertram Flyer bis zum 18.09.2026' };
  assert.equal(taggedTaskAssignee(task, users), 'mara@example.test');
  assert.equal(
    taggedTaskAssignee({ ...task, assignee: '@MARA  BERTRAM' }, users),
    'mara@example.test'
  );
  assert.equal(
    taggedTaskAssignee({ ...task, assignee: 'mara@example.test' }, users),
    'mara@example.test'
  );
  assert.equal(
    taggedTaskAssignee(task, [...users, { name: 'Mara Bertram', login: 'another@example.test' }]),
    undefined
  );
  assert.equal(taggedTaskAssignee(task, [...users, ...users]), 'mara@example.test');
});
test('tags alone, participants, nicknames and partial names never invent an owner', () => {
  const task = { assignee: 'Mara Bertram', quote: '@Mara Bertram erstellt Flyer.' };
  assert.equal(taggedTaskAssignee({ ...task, assignee: '' }, users), undefined);
  assert.equal(taggedTaskAssignee({ ...task, assignee: 'Mara' }, users), undefined);
  assert.equal(
    taggedTaskAssignee({ ...task, assignee: 'Mara Bertram und Flo Feraud' }, users),
    undefined
  );
  assert.equal(
    taggedTaskAssignee({ ...task, quote: 'Mara Bertram erstellt Flyer.' }, users),
    undefined
  );
  assert.equal(
    taggedTaskAssignee({ ...task, quote: '@Mara Bertramm erstellt Flyer.' }, users),
    undefined
  );
  assert.equal(
    taggedTaskAssignee({ ...task, quote: 'mail@Mara Bertram erstellt Flyer.' }, users),
    undefined
  );
});
test('explicit responsibility still matches when the quote mentions other participants', () => {
  const roster = [...users, { name: 'Flo Feraud', login: 'flo@example.test' }];
  assert.equal(
    taggedTaskAssignee(
      { assignee: 'Mara Bertram', quote: '@Mara Bertram erstellt Flyer, @Flo Feraud nimmt teil.' },
      roster
    ),
    'mara@example.test'
  );
  assert.equal(
    taggedTaskAssignee(
      { assignee: '', quote: 'Abschlussgrillen: @Mara Bertram und @Flo Feraud nehmen teil.' },
      roster
    ),
    undefined
  );
});
test('site users use membership UPNs and safely follow local continuation pages', async (t) => {
  t.mock.method(
    token,
    'getCredential',
    () =>
      ({ getToken: async () => ({ token: 'test' }) }) as unknown as ReturnType<
        typeof token.getCredential
      >
  );
  const base = `https://${CONFIG.sharepoint.site.hostName}/sites/${CONFIG.sharepoint.site.name}/_api/web/siteusers`;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(String(url).startsWith(base));
    assert.equal(init?.method, 'GET');
    assert.ok(init?.signal);
    calls++;
    return Response.json(
      calls === 1
        ? {
            value: [
              {
                Title: 'Mara Bertram',
                PrincipalType: 1,
                LoginName: 'i:0#.f|membership|mara@example.test',
                Email: 'private@example.test',
              },
              { Title: 'A group', PrincipalType: 8, LoginName: 'group@example.test' },
              {
                Title: 'Guest',
                PrincipalType: 1,
                LoginName: 'i:0#.f|membership|guest_example.org#EXT#@example.test',
              },
            ],
            'odata.nextLink': `${base}?$skiptoken=page2`,
          }
        : {
            value: [
              {
                Title: 'Flo Feraud',
                PrincipalType: 1,
                LoginName: 'i:0#.f|membership|flo@example.test',
              },
            ],
          }
    );
  });
  assert.deepEqual(await getSharePointSiteUsers(), [
    ...users,
    { name: 'Flo Feraud', login: 'flo@example.test' },
  ]);
  assert.equal(calls, 2);
});
test('site user continuation cannot send credentials to another host', async (t) => {
  t.mock.method(
    token,
    'getCredential',
    () =>
      ({ getToken: async () => ({ token: 'test' }) }) as unknown as ReturnType<
        typeof token.getCredential
      >
  );
  const read = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ value: [], 'odata.nextLink': 'https://other.example/_api/web/siteusers' })
  );
  await assert.rejects(getSharePointSiteUsers(), /Invalid SharePoint site users continuation/);
  assert.equal(read.mock.callCount(), 1);
});

test('full names use the agreed staff login convention and legacy assignments match the account', () => {
  assert.equal(taskAssigneeLogin(' Hugo   Berendi '), 'hugo.berendi@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('@Mara Bertram'), 'mara.bertram@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('Markus Überla'), 'markus.ueberla@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('Bea Groß'), 'bea.gross@stamm-phoenix.de');
  assert.equal(taskAssigneeLogin('Nico'), 'Nico');
  assert.equal(taskAssigneeLogin('Hugo und Mara'), 'Hugo und Mara');
  assert.equal(taskAssigneeLogin('Hugo Berendi und Nico Welles'), 'Hugo Berendi und Nico Welles');
  assert.equal(taskAssigneeLogin('Person@Another.test'), 'person@another.test');
  assert.ok(taskAssignedToLogin('Hugo Berendi', 'hugo.berendi@stamm-phoenix.de'));
  assert.ok(taskAssignedToLogin('HUGO.BERENDI@STAMM-PHOENIX.DE', 'hugo.berendi@stamm-phoenix.de'));
  assert.equal(taskAssignedToLogin('Hugo', 'hugo.berendi@stamm-phoenix.de'), false);
  assert.equal(taskAssignedToLogin('Hugo Berendi', 'nico.welles@stamm-phoenix.de'), false);
  assert.equal(taskAssignedToLogin('', ''), false);
});
