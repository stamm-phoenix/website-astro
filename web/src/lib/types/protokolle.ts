/** Protokolle and their Termin. */
import type { StaffProtokoll } from '../../../../api/lib/protokolle-model';

/** Result of reading the next meeting from the minutes. */
export type ProtokollTerminExtraction =
  'gefunden' | 'unklar' | 'nicht gefunden' | 'fehler' | 'nicht eingerichtet' | 'nicht ausgefuehrt';

export type ProtokollTerminDecision = 'offen' | 'bestaetigt' | 'abgelehnt';

/** Body of `POST /intern/pflege/protokolle/{id}/termin`. */
export interface ProtokollTerminRequest {
  action: 'erkennen' | 'bestaetigen' | 'ablehnen';
  etag: string;
  date?: string;
  time?: string;
  place?: string;
}

export interface StaffProtokolleData {
  /** Whether the document library was found. */
  configured: boolean;
  /** Preset title of new minutes. */
  defaultTitle: string;
  /** Whether a sender mailbox is set up. */
  sendingConfigured: boolean;
  /** Whether meeting-date recognition is enabled in the current deployment. */
  terminConfigured: boolean;
  login: string;
  items: StaffProtokoll[];
}
