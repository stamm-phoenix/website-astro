import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG } from '../lib/config';
import { overrideConfig } from './fixtures/config';
import * as token from '../lib/token';
import { gsmLength, sendSms, SMS_MAX_LENGTH, toGermanMobileNumber, toGsmText } from '../lib/sms';
import { belegSubmittedSmsText, campflowMobileNumber } from '../lib/beleg-sms';

test('German mobile numbers in the usual spellings become E.164', () => {
  for (const raw of [
    '0176 1234567',
    '0176/1234567',
    '+49 176 1234567',
    '+49 (0)176-123 45 67',
    '0049 176 1234567',
    '+490176 1234567',
  ]) {
    assert.equal(toGermanMobileNumber(raw), '+491761234567', raw);
  }
  assert.equal(toGermanMobileNumber('01512 3456789'), '+4915123456789');
});

test('landlines, foreign and malformed numbers are no mobile numbers', () => {
  for (const raw of [
    '+49 8063 12345',
    '08063 12345',
    '+43 664 1234567',
    '176 1234567',
    '0176',
    '',
  ]) {
    assert.equal(toGermanMobileNumber(raw), undefined, raw);
  }
});

test('the first mobile number of a CampFlow person is used', () => {
  assert.equal(
    campflowMobileNumber({
      id: 'per_1',
      phone_numbers: [
        { number: '+49 8063 12345', label: 'Festnetz' },
        { number: '0160 9876543', label: 'Handy' },
        { number: '0176 1234567' },
      ],
    }),
    '+491609876543'
  );
  assert.equal(
    campflowMobileNumber({ id: 'per_2', phone_numbers: [{ number: '08063 1' }] }),
    undefined
  );
  assert.equal(campflowMobileNumber({ id: 'per_3' }), undefined);
  assert.equal(
    campflowMobileNumber({ id: 'per_4', phone_numbers: [null, 'x', { number: 1 }] }),
    undefined
  );
});

test('texts are written in the GSM alphabet so one SMS holds 160 characters', () => {
  assert.equal(toGsmText('Müller „Café“ – 3 €…'), 'Müller "Café" - 3 €...');
  assert.equal(toGsmText('Łódź 😀'), '?odz ?');
  assert.equal(gsmLength('12 €'), 5);
});

test('the SMS to the Kasse names shop, amount and submitter and fits one SMS', () => {
  const url = 'https://stamm-phoenix.de/leitendenbereich/belege';
  assert.equal(
    belegSubmittedSmsText({
      shop: 'REWE',
      amountCent: 1234,
      submitter: 'Lea Leitung',
      resubmitted: false,
      url,
    }),
    `Neuer Beleg zur Prüfung: REWE, 12,34 € von Lea Leitung. ${url}`
  );
  assert.match(
    belegSubmittedSmsText({ shop: 'REWE', amountCent: 1, submitter: 'L', resubmitted: true, url }),
    /^Beleg erneut eingereicht: /
  );
  assert.match(
    belegSubmittedSmsText({
      art: 'Einnahme',
      shop: 'Kuchen',
      amountCent: 1,
      submitter: 'L',
      resubmitted: false,
      url,
    }),
    /^Neue Einnahme zur Prüfung: /
  );
  const long = belegSubmittedSmsText({
    shop: 'Baumarkt '.repeat(20),
    amountCent: 123_456_78,
    submitter: 'Maximiliane Mustermann-Beispielfrau',
    resubmitted: true,
    url,
  });
  assert.ok(gsmLength(long) <= SMS_MAX_LENGTH, long);
  assert.ok(long.endsWith(url));
  assert.equal(toGsmText(long), long);
});

test('SMS are sent with an Entra token and report the numbers that were not accepted', async (t) => {
  overrideConfig(t, CONFIG, { sms: { endpoint: 'https://acs.example.test', sender: 'StammPhnx' } });
  const scopes: string[] = [];
  const getToken = async (scope: string) => {
    scopes.push(scope);
    return { token: 'tok', expiresOnTimestamp: 0 };
  };
  t.mock.method(token, 'getCredential', () => ({ getToken }) as never);
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        value: [
          { to: '+491761234567', successful: true, httpStatusCode: 202 },
          { to: '+491609876543', successful: false, httpStatusCode: 400 },
        ],
      },
      { status: 202 }
    )
  );

  const failed = await sendSms(['+491761234567', '+491609876543'], 'Hallo');

  assert.deepEqual(failed, ['+491609876543']);
  assert.deepEqual(scopes, ['https://communication.azure.com/.default']);
  const [url, init] = fetch.mock.calls[0]?.arguments as [string, RequestInit];
  assert.equal(url, 'https://acs.example.test/sms?api-version=2021-03-07');
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(String(init.body)), {
    from: 'StammPhnx',
    smsRecipients: [{ to: '+491761234567' }, { to: '+491609876543' }],
    message: 'Hallo',
    smsSendOptions: { enableDeliveryReport: false },
  });

  fetch.mock.mockImplementation(async () => new Response('', { status: 401 }));
  await assert.rejects(sendSms(['+491761234567'], 'Hallo'), /401/);
});

test('without a configured resource no SMS is sent', async (t) => {
  overrideConfig(t, CONFIG, { sms: undefined });
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(''));
  assert.deepEqual(await sendSms(['+491761234567'], 'Hallo'), ['+491761234567']);
  assert.equal(fetch.mock.callCount(), 0);
});
