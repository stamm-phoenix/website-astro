/**
 * Reads the answers of NaMi (`nami.ts`) into the few fields the comparison with CampFlow needs.
 * Unknown keys (bank details, Konfession, …) are dropped here and never leave the API. Texts are
 * read leniently: a missing or odd value becomes `''` or `null` instead of refusing the member.
 */
import { z } from 'zod';

const text = z
  .unknown()
  .optional()
  .transform((value) =>
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
  );

/** NaMi writes days as `2010-05-01 00:00:00`; only the day is kept. */
const day = z
  .unknown()
  .optional()
  .transform((value) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
  );

/** A member of NaMi as the comparison uses it. */
export interface NamiMitglied {
  id: number;
  mitgliedsnummer: string;
  vorname: string;
  nachname: string;
  spitzname: string;
  geburtsdatum: string | null;
  /** `männlich`, `weiblich`, `divers` or `''`. */
  geschlecht: string;
  email: string;
  emailVertretungsberechtigter: string;
  telefon: string[];
  eintritt: string | null;
  austritt: string | null;
  /** `Aktiv` or `Inaktiv`. */
  status: string;
  /** `Mitglied`, `Nicht-Mitglied` or `Schnuppermitglied`. */
  mitgliedstyp: string;
  /** `Wölfling`, `Jungpfadfinder`, `Pfadfinder`, `Rover` or `''`. */
  stufe: string;
  /** Only from the single view; `null` when it could not be read. */
  adresse: { strasse: string; plz: string; ort: string } | null;
}

/** An entry of `…/gruppierung/{id}/flist`; its fields carry the prefix `entries_`. */
export const namiMemberListEntry: z.ZodType<NamiMitglied, unknown> = z
  .object({
    id: z.number().int(),
    entries_mitgliedsNummer: text,
    entries_vorname: text,
    entries_nachname: text,
    entries_spitzname: text,
    entries_geburtsDatum: day,
    entries_geschlecht: text,
    entries_email: text,
    entries_emailVertretungsberechtigter: text,
    entries_telefon1: text,
    entries_telefon2: text,
    entries_telefon3: text,
    entries_eintrittsdatum: day,
    entries_austrittsDatum: day,
    entries_status: text,
    entries_mglType: text,
    entries_stufe: text,
  })
  .transform((e) => ({
    id: e.id,
    mitgliedsnummer: e.entries_mitgliedsNummer,
    vorname: e.entries_vorname,
    nachname: e.entries_nachname,
    spitzname: e.entries_spitzname,
    geburtsdatum: e.entries_geburtsDatum,
    geschlecht: e.entries_geschlecht,
    email: e.entries_email,
    emailVertretungsberechtigter: e.entries_emailVertretungsberechtigter,
    telefon: [e.entries_telefon1, e.entries_telefon2, e.entries_telefon3].filter(Boolean),
    eintritt: e.entries_eintrittsdatum,
    austritt: e.entries_austrittsDatum,
    status: e.entries_status,
    mitgliedstyp: e.entries_mglType,
    stufe: e.entries_stufe,
    adresse: null,
  }));

/** The address of a member's single view (`…/gruppierung/{id}/{mitgliedId}`). */
export const namiMemberDetail = z
  .object({ strasse: text, plz: text, ort: text })
  .transform((detail) => ({ adresse: detail }));
