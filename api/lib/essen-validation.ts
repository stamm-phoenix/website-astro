import {
  COLLATOR,
  EINHEITENARTEN,
  einstellungenSchema,
  listNameSchema,
  zutatSchema,
} from './essen-schema';
import type {
  EssenEinheitenart,
  EssenEinstellungen,
  VorlageGruppe,
  ZutatInput,
} from './essen-schema';
import { parseWith } from './validation/zod';

export { COLLATOR, EINHEITENARTEN };
export type { EssenEinheitenart, EssenEinstellungen, VorlageGruppe, ZutatInput };

/**
 * Types and checks of the Steuerung of the Essensplanung, without database access, so the mock
 * API of the website can use them too (`essen-steuerung.ts` reads and writes). The schemas of the
 * forms are in `essen-schema.ts`.
 */

export interface StoredEssenEinstellungen {
  einstellungen: EssenEinstellungen;
  etag: string;
  updatedAt: string;
  updatedBy: string;
}

export interface EssenKategorie {
  id: number;
  etag: string;
  name: string;
  /** How many ingredients use it; a used category cannot be deleted. */
  zutaten: number;
}

export interface EssenUnvertraeglichkeit {
  id: number;
  etag: string;
  /** Key of the 14 EU allergens; those cannot be deleted. */
  schluessel: string | null;
  name: string;
  zutaten: number;
}

export interface EssenZutat extends ZutatInput {
  id: number;
  etag: string;
  geaendertAm: string;
  geaendertVon: string;
}

export interface EssenAuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
}

/** A Planung in the list of the Steuerung. */
export interface EssenPlanungUebersicht {
  id: number;
  etag: string;
  name: string;
  /** `YYYY-MM-DD`; null while the Planung has no days. */
  ersterTag: string | null;
  letzterTag: string | null;
  erstelltAm: string;
  geaendertAm: string;
  besitzer: { name: string; email: string | null }[];
  mitglieder: number;
  /** When the retention deletes it (`YYYY-MM-DD`). */
  loeschtAm: string | null;
}

export interface EssenSteuerungView extends StoredEssenEinstellungen {
  planungen: EssenPlanungUebersicht[];
  kategorien: EssenKategorie[];
  unvertraeglichkeiten: EssenUnvertraeglichkeit[];
  zutaten: EssenZutat[];
  log: EssenAuditEntry[];
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// The readers of stored JSON are lenient on purpose: they keep what they can read.

export function readGruppen(value: string): VorlageGruppe[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item: unknown) => {
    const gruppe = item as { name?: unknown; faktor?: unknown };
    return typeof gruppe?.name === 'string' && typeof gruppe.faktor === 'number'
      ? [{ name: gruppe.name, faktor: gruppe.faktor }]
      : [];
  });
}

export function readStrings(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
}

/** Checks the form of the Steuerung; field errors use the keys of the form, e.g. `whitelist.1`. */
export function validateEssenEinstellungen(input: unknown): EssenEinstellungen {
  return parseWith(einstellungenSchema, input, (path) => path.join('.'));
}

/**
 * Whether `email` may create a Planung: addresses of the Stamm always, everyone else only while
 * creating by externals is switched on and the whitelist is empty or names the address or its
 * domain.
 */
export function darfPlanungAnlegen(email: string, einstellungen: EssenEinstellungen): boolean {
  const address = email.trim().toLowerCase();
  const domain = address.split('@')[1] ?? '';
  if (domain === 'stamm-phoenix.de') return true;
  if (!einstellungen.anlegenExtern) return false;
  if (einstellungen.whitelist.length === 0) return true;
  return einstellungen.whitelist.some((entry) => entry === address || entry === domain);
}

export function validateZutat(input: unknown): ZutatInput {
  return parseWith(zutatSchema, input);
}

export function validateListName(input: unknown): string {
  return parseWith(listNameSchema, input).name;
}
