import assert from 'node:assert/strict';
import test from 'node:test';
import * as env from '../lib/environment';
import * as campflow from '../lib/campflow';
import * as mail from '../lib/mail';
import {
  sammelInvitationRecipients,
  sammelAudienceVersion,
  sammelInvitationStep,
} from '../lib/sammelbestellung-invitations';
import { getDb } from '../lib/db';
import { getSammelCampaign } from '../lib/sammelbestellung-list';
import { dbTest } from './fixtures/database';
import { sammelCampaign, seedSammel } from './fixtures/sammel';

const SITE = 'https://example.test';

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

async function stored(): Promise<{ address: string; status: string }[]> {
  return getDb()
    .selectFrom('sammel.invitation')
    .select(['address', 'status'])
    .orderBy('address')
    .execute();
}

dbTest(
  'confirms exact audience, reserves before sending and resumes without duplicates',
  async (t) => {
    await seedSammel([sammelCampaign()], []);
    const campaign = (await getSammelCampaign('1'))!;
    t.mock.method(env, 'getEnvironment', () => 'test-secret-longer-than-thirty-two-characters');
    const contacts = t.mock.method(campflow, 'campflowGetAll', async () => [
      { id: '1', primary_email: 'one@example.test' },
      { id: '2', primary_email: 'two@example.test' },
    ]);
    const sent: string[] = [];
    let fail = false;
    t.mock.method(mail, 'sendMail', async (to: string) => {
      assert.equal((await stored()).find((row) => row.address === to)?.status, 'attempted');
      sent.push(to);
      if (fail) throw new Error('Unknown mail result');
    });
    const preview = await sammelInvitationStep(campaign, 'preview', SITE);
    assert.equal(preview.total, 2);
    assert.deepEqual(await stored(), []);
    assert.equal(sent.length, 0);
    await assert.rejects(sammelInvitationStep(campaign, 'send', SITE, 'wrong-version'));
    assert.deepEqual(await stored(), []);
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
    assert.deepEqual(await stored(), [
      { address: 'one@example.test', status: 'sent' },
      { address: 'two@example.test', status: 'attempted' },
    ]);
    assert.equal(
      sammelAudienceVersion(['one@example.test']),
      sammelAudienceVersion(['one@example.test'])
    );
  }
);

dbTest('concurrent invitation steps cannot reserve the same recipient twice', async (t) => {
  await seedSammel([sammelCampaign()], []);
  const campaign = (await getSammelCampaign('1'))!;
  t.mock.method(env, 'getEnvironment', () => 'test-secret-longer-than-thirty-two-characters');
  const addresses = ['one@example.test', 'two@example.test', 'three@example.test'];
  t.mock.method(campflow, 'campflowGetAll', async () =>
    addresses.map((address, index) => ({ id: String(index), primary_email: address }))
  );
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const { version } = await sammelInvitationStep(campaign, 'preview', SITE);
  // Two tabs confirm the same audience at once: one list, every address once
  await Promise.all(
    Array.from({ length: 2 }, () => sammelInvitationStep(campaign, 'send', SITE, version))
  );
  await Promise.all(Array.from({ length: 4 }, () => sammelInvitationStep(campaign, 'send', SITE)));
  const recipients = send.mock.calls.map((call) => call.arguments[0]);
  assert.deepEqual([...recipients].sort(), [...addresses].sort());
  assert.equal((await sammelInvitationStep(campaign, 'preview', SITE)).sent, 3);
});

dbTest('invitations keep addresses apart that only the database collation equates', async (t) => {
  await seedSammel([sammelCampaign()], []);
  const campaign = (await getSammelCampaign('1'))!;
  t.mock.method(env, 'getEnvironment', () => 'test-secret-longer-than-thirty-two-characters');
  t.mock.method(campflow, 'campflowGetAll', async () => [
    { id: '1', primary_email: 'familie@straße.de' },
    { id: '2', primary_email: 'familie@strasse.de' },
  ]);
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const { version } = await sammelInvitationStep(campaign, 'preview', SITE);
  await sammelInvitationStep(campaign, 'send', SITE, version);
  await sammelInvitationStep(campaign, 'send', SITE);
  assert.deepEqual(send.mock.calls.map((call) => call.arguments[0]).sort(), [
    'familie@strasse.de',
    'familie@straße.de',
  ]);
});
