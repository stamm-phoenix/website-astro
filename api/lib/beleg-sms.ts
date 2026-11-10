import type { CampflowPerson } from './campflow';
import { campflowGet } from './campflow';
import { getDb } from './db';
import { SMS_MAX_LENGTH, gsmLength, toGermanMobileNumber, toGsmText } from './sms';

/** The CampFlow member list, where the linked persons of the leaders live. */
const MEMBER_PERSONS = '/lists/member/persons';

/** The first German mobile number of a CampFlow person, in E.164, or `undefined`. */
export function campflowMobileNumber(person: CampflowPerson): string | undefined {
  const numbers = Array.isArray(person.phone_numbers) ? person.phone_numbers : [];
  for (const entry of numbers) {
    const raw =
      entry && typeof entry === 'object' ? (entry as Record<string, unknown>).number : undefined;
    const mobile = typeof raw === 'string' ? toGermanMobileNumber(raw) : undefined;
    if (mobile) return mobile;
  }
  return undefined;
}

/**
 * The mobile numbers of the given logins: account → linked person in the module „Personen“ →
 * CampFlow member list. Logins without a link, without a mobile number or whose person cannot be
 * read are left out. Each number appears once.
 */
export async function mobileNumbersOf(logins: readonly string[]): Promise<string[]> {
  if (logins.length === 0) return [];
  const rows = await getDb()
    .selectFrom('organisation.person')
    .select('campflow_person_id')
    .where(
      'login',
      'in',
      logins.map((login) => login.trim().toLowerCase())
    )
    .where('campflow_person_id', '!=', '')
    .execute();
  const persons = await Promise.allSettled(
    rows.map((row) =>
      campflowGet<CampflowPerson>(`${MEMBER_PERSONS}/${encodeURIComponent(row.campflow_person_id)}`)
    )
  );
  const numbers = persons
    .map((result) =>
      result.status === 'fulfilled' ? campflowMobileNumber(result.value) : undefined
    )
    .filter((number): number is string => number !== undefined);
  return [...new Set(numbers)];
}

export interface SubmittedBelegSms {
  art?: 'Ausgabe' | 'Einnahme';
  shop: string;
  amountCent: number;
  /** Name (or login) of the person who submitted the receipt. */
  submitter: string;
  resubmitted: boolean;
  url: string;
}

function formatEuro(cent: number): string {
  return toGsmText(
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cent / 100)
  );
}

/** `value` in the GSM alphabet, cut to `max` counted characters with a trailing „..“. */
function shorten(value: string, max: number): string {
  const text = toGsmText(value.replace(/\s+/g, ' ').trim());
  if (gsmLength(text) <= max) return text;
  let cut = '';
  for (const char of text) {
    if (gsmLength(cut + char) > max - 2) break;
    cut += char;
  }
  return max < 3 ? '' : `${cut.trimEnd()}..`;
}

/**
 * The SMS to the Kasse about a submitted receipt, at most one SMS long: shop and submitter are
 * shortened so the link always fits.
 */
export function belegSubmittedSmsText(data: SubmittedBelegSms): string {
  const heading = data.resubmitted
    ? 'Beleg erneut eingereicht'
    : data.art === 'Einnahme'
      ? 'Neue Einnahme zur Prüfung'
      : 'Neuer Beleg zur Prüfung';
  const amount = formatEuro(data.amountCent);
  const fixed = gsmLength(`${heading}: ,  von . ${data.url}${amount}`);
  const room = Math.max(0, SMS_MAX_LENGTH - fixed);
  const submitter = shorten(data.submitter, Math.min(30, Math.floor(room / 2)));
  const shop = shorten(data.shop, room - gsmLength(submitter));
  return `${heading}: ${shop}, ${amount} von ${submitter}. ${data.url}`;
}
