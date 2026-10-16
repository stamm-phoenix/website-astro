import type { StaffProtokoll } from './types';

/** Same limit as `MAX_PROTOKOLL_EXTRA_RECIPIENTS` in the API. */
export const MAX_EXTRA_RECIPIENTS = 20;

/** A recipient from CampFlow, with the reasons why it gets the minutes. */
export interface ProtokollRecipient {
  email: string;
  name: string;
  reasons: string[];
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

/** Number of addresses the delivery goes to. */
export function auswahlCount(auswahl: ProtokollVersandAuswahl): number {
  return auswahl.list.filter((r) => !auswahl.excluded.includes(r.email)).length + auswahl.extra.length;
}

/** „1 Person“, „3 Personen“. */
export function personen(count: number): string {
  return count === 1 ? '1 Person' : `${count} Personen`;
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
