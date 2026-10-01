import assert from 'node:assert/strict';
import test from 'node:test';
import * as graph from '../lib/sharepoint-data-access';
import * as env from '../lib/environment';
import * as campflow from '../lib/campflow';
import * as mail from '../lib/mail';
import {
  sammelInvitationRecipients,
  sammelAudienceVersion,
  sammelInvitationStep,
} from '../lib/sammelbestellung-invitations';
import type { SammelAktion } from '../lib/sammelbestellung-model';

const SITE = 'https://example.test';
const campaign: SammelAktion = {
  id: '1',
  etag: 'v1',
  title: 'Test',
  description: '',
  startsAt: '2020-01-01',
  endsAt: '2099-01-01',
  catalog: [],
  archived: false,
};

test('deduplicates member and CC addresses and excludes past/future members', () => {
  assert.deepEqual(
    sammelInvitationRecipients(
      [
        { id: '1', primary_email: ' FAMILY@Example.Test ', cc_emails: ['Parent@example.test'] },
        { id: '2', primary_email: 'family@example.test', cc_emails: ['parent@example.test'] },
        { id: '3', primary_email: 'former@example.test', leave_date: '2026-10-01' },
        { id: '4', primary_email: 'future@example.test', join_date: '2026-10-02' },
        { id: '5', primary_email: 'invalid' },
      ],
      '2026-10-01'
    ),
    ['family@example.test', 'parent@example.test']
  );
});

test('confirms exact audience, reserves before sending and resumes without duplicates', async (t) => {
  let revision = 1;
  let stored = '';
  t.mock.method(env, 'getEnvironment', () => 'test-secret-longer-than-thirty-two-characters');
  t.mock.method(graph, 'getSharePointListItem', async () => ({
    id: '1',
    eTag: 'v' + revision,
    fields: { Einladungsversand: stored },
  }));
  t.mock.method(
    graph,
    'updateSharePointListItem',
    async (_list: string, _id: string, fields: Record<string, unknown>, etag?: string) => {
      if (etag !== 'v' + revision) throw Object.assign(new Error('Conflict'), { statusCode: 412 });
      stored = String(fields.Einladungsversand);
      revision++;
    }
  );
  const contacts = t.mock.method(campflow, 'campflowGetAll', async () => [
    { id: '1', primary_email: 'one@example.test' },
    { id: '2', primary_email: 'two@example.test' },
  ]);
  const sent: string[] = [];
  let fail = false;
  t.mock.method(mail, 'sendMail', async (to: string) => {
    assert.equal(
      JSON.parse(stored).recipients.find((row: { address: string }) => row.address === to).status,
      'attempted'
    );
    sent.push(to);
    if (fail) throw new Error('Unknown mail result');
  });
  const preview = await sammelInvitationStep(campaign, 'preview', SITE);
  assert.equal(preview.total, 2);
  assert.equal(stored, '');
  assert.equal(sent.length, 0);
  await assert.rejects(sammelInvitationStep(campaign, 'send', SITE, 'wrong-version'));
  assert.equal(stored, '');
  const first = await sammelInvitationStep(campaign, 'send', SITE, preview.version);
  assert.equal(first.sent, 1);
  assert.equal(first.pending, 1);
  fail = true;
  await assert.rejects(sammelInvitationStep(campaign, 'send', SITE));
  const final = await sammelInvitationStep(campaign, 'preview', SITE);
  assert.equal(final.sent, 1);
  assert.equal(final.pending, 0);
  assert.equal(final.uncertain, 1);
  await sammelInvitationStep(campaign, 'send', SITE);
  assert.deepEqual(sent, ['one@example.test', 'two@example.test']);
  assert.equal(contacts.mock.calls.length, 3);
  assert.equal(
    sammelAudienceVersion(['one@example.test']),
    sammelAudienceVersion(['one@example.test'])
  );
});

test('concurrent invitation steps cannot reserve the same recipient twice', async (t) => {
  let stored = JSON.stringify({ recipients: [{ address: 'one@example.test', status: 'pending' }] });
  let revision = 1;
  t.mock.method(env, 'getEnvironment', () => 'test-secret-longer-than-thirty-two-characters');
  t.mock.method(graph, 'getSharePointListItem', async () => ({
    id: '1',
    eTag: 'v' + revision,
    fields: { Einladungsversand: stored },
  }));
  t.mock.method(
    graph,
    'updateSharePointListItem',
    async (_list: string, _id: string, fields: Record<string, unknown>, etag?: string) => {
      if (etag !== 'v' + revision) throw Object.assign(new Error('Conflict'), { statusCode: 412 });
      stored = String(fields.Einladungsversand);
      revision++;
    }
  );
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const results = await Promise.allSettled([
    sammelInvitationStep(campaign, 'send', SITE),
    sammelInvitationStep(campaign, 'send', SITE),
  ]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(send.mock.calls.length, 1);
  assert.equal((await sammelInvitationStep(campaign, 'preview', SITE)).sent, 1);
});
