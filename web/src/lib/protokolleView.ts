import { ApiError, errorMessage } from './api';
import type { StaffProtokoll } from './types';

/** Same limit as `MAX_PROTOKOLL_EXTRA_RECIPIENTS` in the API. */
export const MAX_EXTRA_RECIPIENTS = 20;

/** A recipient from CampFlow, with the reasons why it gets the minutes. */
export interface ProtokollRecipient {
  email: string;
  name: string;
  reasons: string[];
  /** The own address, matched on the server by the linked CampFlow person. */
  ich?: boolean;
}

/** Answer of the `preview` action of both delivery endpoints. */
export interface ProtokollVersandPreview {
  recipients: number;
  version: string;
  list: ProtokollRecipient[];
}

/** The confirmed list and the changes for one delivery. */
export interface ProtokollVersandAuswahl extends ProtokollVersandPreview {
  retry: boolean;
  /** Addresses from CampFlow taken out for this delivery. */
  excluded: string[];
  /** Addresses added by hand for this delivery. */
  extra: string[];
  /** Text in the address field that was not added yet. */
  pending: string;
}

export interface ProtokollSending extends ProtokollVersandAuswahl {
  protokoll: StaffProtokoll;
}

/** Starts the selection with everyone from CampFlow. */
export function startAuswahl(
  preview: ProtokollVersandPreview,
  retry: boolean
): ProtokollVersandAuswahl {
  return { ...preview, retry, excluded: [], extra: [], pending: '' };
}

/** Number of addresses the delivery goes to, each once like in the API. */
export function auswahlCount(auswahl: ProtokollVersandAuswahl): number {
  const addresses = new Set(
    auswahl.list.map((r) => r.email).filter((email) => !auswahl.excluded.includes(email))
  );
  for (const email of auswahl.extra) addresses.add(email);
  return addresses.size;
}

/**
 * Takes a newer list from CampFlow into the selection after a failed delivery. Taken-out
 * addresses that are no longer on the list are dropped, added ones and the typed text stay.
 */
export function refreshAuswahl<T extends ProtokollVersandAuswahl>(
  auswahl: T,
  preview: ProtokollVersandPreview
): { auswahl: T; changed: boolean } {
  const listed = new Set(preview.list.map((r) => r.email));
  return {
    auswahl: {
      ...auswahl,
      ...preview,
      excluded: auswahl.excluded.filter((email) => listed.has(email)),
      // Added addresses that are now on the list are chosen by their tick from now on
      extra: auswahl.extra.filter((email) => !listed.has(email)),
    },
    changed: preview.version !== auswahl.version,
  };
}

/** Added to the error when the list was reloaded after a failed delivery. */
export const LIST_RELOADED =
  'Die Liste aus CampFlow hat sich geändert und ist jetzt neu geladen. Deine Auswahl bleibt erhalten, prüf sie bitte noch einmal.';

/** „1 Person“, „3 Personen“. */
export function personen(count: number): string {
  return count === 1 ? '1 Person' : `${count} Personen`;
}

/** Whether closing would lose a change to the list; `EditDialog` only sees the form fields. */
export function auswahlDirty(auswahl: ProtokollVersandAuswahl | null): boolean {
  return (
    auswahl !== null &&
    (auswahl.excluded.length > 0 || auswahl.extra.length > 0 || auswahl.pending.trim() !== '')
  );
}

/** Message when an address was typed but not added, or null. */
export function pendingProblem(auswahl: ProtokollVersandAuswahl): string | null {
  const pending = auswahl.pending.trim();
  return pending
    ? `Die Adresse „${pending}“ ist noch nicht hinzugefügt. Tippe auf „Hinzufügen“ oder leere das Feld. Es wurde nichts verschickt.`
    : null;
}

/** The fields of the `send` action that change the list. */
export function auswahlBody(auswahl: ProtokollVersandAuswahl): {
  version: string;
  retry: boolean;
  excluded: string[];
  extra: string[];
} {
  const { version, retry, excluded, extra } = auswahl;
  return { version, retry, excluded, extra };
}

/** Rough check like the API's; the API decides. */
export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Error text of the delivery endpoints. A refused check names its reason in `fields.form`; it
 * always comes before the mail, so nothing was sent.
 */
export function versandProblem(error: unknown, fallback: string): string {
  const form = error instanceof ApiError ? error.fields?.form : undefined;
  return form ? `${form} Es wurde nichts verschickt.` : errorMessage(error, fallback);
}
