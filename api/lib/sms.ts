import { CONFIG } from './config';
import { getCredential } from './token';

/**
 * SMS through Azure Communication Services (`docs/sms.md`). The API signs in with the
 * certificate of its app registration, which holds a role on the resource; there is no access
 * key. Without `CONFIG.sms` nothing is sent.
 */

/** Scope of the Entra token for Azure Communication Services. */
const ACS_SCOPE = 'https://communication.azure.com/.default';
const SMS_API_VERSION = '2021-03-07';
/** One SMS of the GSM alphabet; longer texts are split and cost more. */
export const SMS_MAX_LENGTH = 160;

/** The basic GSM 03.38 alphabet; one character outside it makes an SMS hold only 70. */
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
);
/** Characters of the GSM extension table; each counts twice. */
const GSM_EXTENSION = new Set('^{}\\[~]|€');

/**
 * `value` in the GSM alphabet: typographic quotes, dashes and spaces become plain ones, accents
 * outside the alphabet are dropped (`ł` becomes `?`), so the SMS keeps 160 characters.
 */
export function toGsmText(value: string): string {
  const plain = value
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, ' ')
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...');
  let result = '';
  for (const char of plain.normalize('NFC')) {
    if (GSM_BASIC.has(char) || GSM_EXTENSION.has(char)) {
      result += char;
      continue;
    }
    const base = char.normalize('NFD').replace(/\p{M}/gu, '');
    result += [...base].every((c) => GSM_BASIC.has(c)) && base !== '' ? base : '?';
  }
  return result;
}

/** Length of a GSM text as the network counts it. */
export function gsmLength(value: string): number {
  let length = 0;
  for (const char of value) length += GSM_EXTENSION.has(char) ? 2 : 1;
  return length;
}

/** German mobile numbers start with 015, 016 or 017 after the leading zero. */
const GERMAN_MOBILE = /^1[5-7]\d{7,10}$/;

/**
 * A German mobile number in E.164 (`+4917612345678`), or `undefined` for landlines, foreign
 * and malformed numbers. Accepts the usual spellings: `0176 1234567`, `+49 (0)176-123 45 67`,
 * `0049 176 1234567`.
 */
export function toGermanMobileNumber(raw: string): string | undefined {
  const compact = raw.replace(/\(0\)/g, '').replace(/[\s()/.-]/g, '');
  let national: string;
  if (compact.startsWith('+49')) national = compact.slice(3);
  else if (compact.startsWith('0049')) national = compact.slice(4);
  else if (compact.startsWith('0')) national = compact.slice(1);
  else return undefined;
  national = national.replace(/^0/, '');
  return GERMAN_MOBILE.test(national) ? `+49${national}` : undefined;
}

/** Whether SMS can be sent in this deployment. */
export function isSmsConfigured(): boolean {
  return CONFIG.sms !== undefined;
}

interface SmsSendResult {
  to?: unknown;
  successful?: unknown;
}

/**
 * Sends `message` to each number (E.164) within `timeoutMs` and without retries.
 * @returns The numbers whose SMS was not accepted; all of them if the request failed.
 */
export async function sendSms(
  recipients: readonly string[],
  message: string,
  timeoutMs = 10_000
): Promise<string[]> {
  const config = CONFIG.sms;
  if (!config || recipients.length === 0) return [...recipients];
  const signal = AbortSignal.timeout(Math.max(1, timeoutMs));
  const token = await getCredential().getToken(ACS_SCOPE, { abortSignal: signal });
  if (!token) throw new Error('Kein Zugriffstoken für Azure Communication Services');
  const response = await fetch(`${config.endpoint}/sms?api-version=${SMS_API_VERSION}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.sender,
      smsRecipients: recipients.map((to) => ({ to })),
      message,
      smsSendOptions: { enableDeliveryReport: false },
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`SMS-Versand fehlgeschlagen: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json().catch(() => ({}))) as { value?: unknown };
  const results = Array.isArray(body.value) ? (body.value as SmsSendResult[]) : [];
  const accepted = new Set(
    results.filter((result) => result.successful === true).map((result) => String(result.to))
  );
  return recipients.filter((to) => !accepted.has(to));
}
