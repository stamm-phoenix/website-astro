export interface Schulferien {
  name: string;
  start: string;
  end: string;
}

export function berlinDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}

// Official Bavarian Ferienordnung, checked 2026-11-03:
// https://www.gesetze-bayern.de/Content/Document/BayVV_2230_1_1_0_K_13479-0
// Inclusive first/last days. Extend coverage and the build deadline together
// when the next Ferienordnung is published; never infer missing holidays.
const COVERAGE_START = '2025-08-01';
const COVERAGE_END = '2030-09-09';
const RENEW_BY = '2030-06-01';

const FERIEN: Schulferien[] = [
  { name: 'Sommerferien', start: '2025-08-01', end: '2025-09-15' },
  { name: 'Herbstferien', start: '2025-11-03', end: '2025-11-07' },
  { name: 'Weihnachtsferien', start: '2025-12-22', end: '2026-01-05' },
  { name: 'Frühjahrsferien', start: '2026-02-16', end: '2026-02-20' },
  { name: 'Osterferien', start: '2026-03-30', end: '2026-04-10' },
  { name: 'Pfingstferien', start: '2026-05-26', end: '2026-06-05' },
  { name: 'Sommerferien', start: '2026-08-03', end: '2026-09-14' },
  { name: 'Herbstferien', start: '2026-11-02', end: '2026-11-06' },
  { name: 'Weihnachtsferien', start: '2026-12-24', end: '2027-01-08' },
  { name: 'Frühjahrsferien', start: '2027-02-08', end: '2027-02-12' },
  { name: 'Osterferien', start: '2027-03-22', end: '2027-04-02' },
  { name: 'Pfingstferien', start: '2027-05-18', end: '2027-05-28' },
  { name: 'Sommerferien', start: '2027-08-02', end: '2027-09-13' },
  { name: 'Herbstferien', start: '2027-11-02', end: '2027-11-05' },
  { name: 'Weihnachtsferien', start: '2027-12-24', end: '2028-01-07' },
  { name: 'Frühjahrsferien', start: '2028-02-28', end: '2028-03-03' },
  { name: 'Osterferien', start: '2028-04-10', end: '2028-04-21' },
  { name: 'Pfingstferien', start: '2028-06-06', end: '2028-06-16' },
  { name: 'Sommerferien', start: '2028-07-31', end: '2028-09-11' },
  { name: 'Herbstferien', start: '2028-10-30', end: '2028-11-03' },
  { name: 'Weihnachtsferien', start: '2028-12-23', end: '2029-01-05' },
  { name: 'Frühjahrsferien', start: '2029-02-12', end: '2029-02-16' },
  { name: 'Osterferien', start: '2029-03-26', end: '2029-04-06' },
  { name: 'Pfingstferien', start: '2029-05-22', end: '2029-06-01' },
  { name: 'Sommerferien', start: '2029-07-30', end: '2029-09-10' },
  { name: 'Herbstferien', start: '2029-10-29', end: '2029-11-02' },
  { name: 'Weihnachtsferien', start: '2029-12-24', end: '2030-01-04' },
  { name: 'Frühjahrsferien', start: '2030-03-04', end: '2030-03-08' },
  { name: 'Osterferien', start: '2030-04-15', end: '2030-04-26' },
  { name: 'Pfingstferien', start: '2030-06-11', end: '2030-06-21' },
  { name: 'Sommerferien', start: '2030-07-29', end: '2030-09-09' },
];

/** null = known school day; undefined = date outside verified coverage. */
export function currentSchulferien(date: string): Schulferien | null | undefined {
  if (date < COVERAGE_START || date > COVERAGE_END) return undefined;
  return FERIEN.find((ferien) => ferien.start <= date && date <= ferien.end) ?? null;
}

/** Stop builds early enough to renew the calendar before visitors lose coverage. */
export function requireCurrentSchulferien(now = new Date()): void {
  if (berlinDate(now) >= RENEW_BY) {
    throw new Error('Bayerische Schulferien erneuern: amtliche Termine ab September 2030 fehlen.');
  }
}
