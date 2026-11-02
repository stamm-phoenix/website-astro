import type { StatusTone } from './status';
import type { SchnupperStatus, StaffSchnupperAnfrage } from '../../../api/lib/schnupper-model';

// The rules of the request form are shared with the API, which checks requests against them.
// Edit them in api/lib/schnupper-model.ts.
export {
  SCHNUPPER_ALTER,
  SCHNUPPER_MAX_LENGTH,
  SCHNUPPER_STUFEN,
  SCHNUPPER_STUFE_LABELS,
  stufeFuerAlter,
  validateSchnupperAnfrage,
} from '../../../api/lib/schnupper-model';
export type {
  SchnupperAntwortErgebnis,
  SchnupperField,
  SchnupperStatus,
  SchnupperStufe,
  StaffSchnupperAnfrage,
} from '../../../api/lib/schnupper-model';

/** Answer of `POST /api/schnupperanfrage`. */
export interface SchnupperSent {
  status: 'sent';
  /** Whether the receipt to the family went out; the request is saved either way. */
  receipt: boolean;
}

export const SCHNUPPER_STATUS_LABELS: Record<SchnupperStatus, string> = {
  offen: 'Offen',
  bestaetigt: 'Termin bestätigt',
  abgesagt: 'Abgesagt',
};

export const SCHNUPPER_STATUS_TONES: Record<SchnupperStatus, StatusTone> = {
  offen: 'warning',
  bestaetigt: 'success',
  abgesagt: 'neutral',
};

export type SchnupperFilter = SchnupperStatus | 'alle';

/** The requests of one state, or all. */
export function filterSchnupper(
  items: readonly StaffSchnupperAnfrage[],
  filter: SchnupperFilter
): StaffSchnupperAnfrage[] {
  return filter === 'alle' ? [...items] : items.filter((item) => item.status === filter);
}

/** „Di., 10.03.2099, 17:30 Uhr“ for a confirmed date. */
export function terminText(termin: { datum: string; zeit: string }): string {
  const datum = new Date(`${termin.datum}T12:00:00Z`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${datum}, ${termin.zeit} Uhr`;
}

/** The day of arrival in Berlin, e.g. „02.11.2026“. */
export function eingangText(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
}

/** The Gruppenstunde fields the form needs, with its notice for changed dates if any. */
export interface SchnupperGruppenstunde {
  stufe: string;
  weekday: string;
  time: string;
  location: string;
  exception?: {
    startDate: string;
    endDate: string;
    message: string;
    location: string;
    time: string;
  } | null;
}

/**
 * The weekday, time and place of the Gruppenstunde of a Stufe (`stufe` is the name such as
 * „Wölflinge“); a notice valid on `today` (`YYYY-MM-DD`, Berlin) comes first with its own
 * place and time. `null` when the Stufe has no Gruppenstunde.
 */
export function gruppenstundeText(
  gruppenstunden: readonly SchnupperGruppenstunde[],
  stufeName: string,
  today: string
): string | null {
  const stunde = gruppenstunden.find((g) => g.stufe === stufeName);
  if (!stunde) return null;
  const regulaer = [`${stunde.weekday}, ${stunde.time}`, stunde.location]
    .filter(Boolean)
    .join(' · ');
  const hinweis = stunde.exception;
  if (!hinweis || hinweis.startDate > today || today > hinweis.endDate) return regulaer;
  const geaendert = [hinweis.message, hinweis.time, hinweis.location].filter(Boolean).join(' · ');
  return `${geaendert} (sonst ${regulaer})`;
}
