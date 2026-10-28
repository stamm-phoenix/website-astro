import type { EssenEinheitenart } from './db-schema';
import type { FieldErrors } from './pflege-validation';
import { ValidationError } from './pflege-validation';

/**
 * Types and checks of the Steuerung of the Essensplanung, without database access, so the mock
 * API of the website can use them too (`essen-steuerung.ts` reads and writes).
 */

export const EINHEITENARTEN: readonly EssenEinheitenart[] = [
  'masse',
  'volumen',
  'stueck',
  'packung',
  'bund',
];

export interface VorlageGruppe {
  name: string;
  faktor: number;
}

export interface EssenEinstellungen {
  anlegenExtern: boolean;
  /** Addresses and domains (lower case) that may create Planungen; empty: every address. */
  whitelist: string[];
  aufbewahrungMonate: number;
  wartung: boolean;
  vorlageGruppen: VorlageGruppe[];
  vorlageMahlzeiten: string[];
}

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

export interface ZutatInput {
  name: string;
  kategorieId: number;
  einheitenart: EssenEinheitenart;
  abtropfgewicht: boolean;
  lebensmittel: boolean;
  /** null: not known yet. */
  vegetarisch: boolean | null;
  vegan: boolean | null;
  merkmaleGeprueft: boolean;
  hinweis: string;
  grammProTl: number | null;
  grammProEl: number | null;
  grammProStueck: number | null;
  /** IDs of `essen.unvertraeglichkeit`. */
  allergene: number[];
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

export interface EssenSteuerungView extends StoredEssenEinstellungen {
  kategorien: EssenKategorie[];
  unvertraeglichkeiten: EssenUnvertraeglichkeit[];
  zutaten: EssenZutat[];
  log: EssenAuditEntry[];
}

export const COLLATOR = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

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

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/;
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A trimmed text of at most `max` characters, or an error message. */
function readName(value: unknown, max: number, errors: FieldErrors, field: string): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) errors[field] = 'Bitte einen Namen eintragen.';
  else if (name.length > max) errors[field] = `Höchstens ${max} Zeichen.`;
  return name;
}

function readBoolean(value: unknown, errors: FieldErrors, field: string): boolean {
  if (typeof value !== 'boolean') errors[field] = 'Bitte ja oder nein wählen.';
  return value === true;
}

/** A positive number with at most two decimals, or null for an empty field. */
function readGramm(value: unknown, errors: FieldErrors, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100_000) {
    errors[field] = 'Bitte eine Zahl größer als 0 eintragen oder das Feld leer lassen.';
    return null;
  }
  return Math.round(value * 100) / 100;
}

function hasDuplicate(names: string[]): number {
  return names.findIndex(
    (name, index) => names.findIndex((other) => COLLATOR.compare(other, name) === 0) !== index
  );
}

/** Checks the form of the Steuerung; field errors use the keys of the form, e.g. `whitelist.1`. */
export function validateEssenEinstellungen(input: unknown): EssenEinstellungen {
  const errors: FieldErrors = {};
  const value = isRecord(input) ? input : {};

  const anlegenExtern = readBoolean(value.anlegenExtern, errors, 'anlegenExtern');
  const wartung = readBoolean(value.wartung, errors, 'wartung');

  const whitelist: string[] = [];
  if (!Array.isArray(value.whitelist)) errors.whitelist = 'Bitte eine Liste angeben.';
  else {
    value.whitelist.forEach((entry: unknown, index) => {
      const text = typeof entry === 'string' ? entry.trim().toLowerCase().replace(/^@/, '') : '';
      if (!text) return;
      if (!EMAIL.test(text) && !DOMAIN.test(text)) {
        errors[`whitelist.${index}`] =
          'Bitte eine Mailadresse (name@beispiel.de) oder eine Domain (beispiel.de) eintragen.';
      } else if (!whitelist.includes(text)) {
        whitelist.push(text);
      }
    });
  }

  const monate = value.aufbewahrungMonate;
  if (typeof monate !== 'number' || !Number.isInteger(monate) || monate < 1 || monate > 120) {
    errors.aufbewahrungMonate = 'Bitte eine ganze Zahl von 1 bis 120 Monaten eintragen.';
  }

  const vorlageGruppen: VorlageGruppe[] = [];
  if (!Array.isArray(value.vorlageGruppen) || value.vorlageGruppen.length === 0) {
    errors.vorlageGruppen = 'Bitte mindestens eine Gruppe eintragen.';
  } else if (value.vorlageGruppen.length > 20) {
    errors.vorlageGruppen = 'Höchstens 20 Gruppen.';
  } else {
    value.vorlageGruppen.forEach((item: unknown, index) => {
      const gruppe = isRecord(item) ? item : {};
      const name = readName(gruppe.name, 50, errors, `vorlageGruppen.${index}.name`);
      const faktor = gruppe.faktor;
      if (typeof faktor !== 'number' || !Number.isFinite(faktor) || faktor <= 0 || faktor > 5) {
        errors[`vorlageGruppen.${index}.faktor`] = 'Bitte einen Faktor über 0 und bis 5 eintragen.';
      }
      vorlageGruppen.push({
        name,
        faktor: typeof faktor === 'number' ? Math.round(faktor * 100) / 100 : 0,
      });
    });
    const duplicate = hasDuplicate(vorlageGruppen.map((gruppe) => gruppe.name));
    if (duplicate >= 0) errors[`vorlageGruppen.${duplicate}.name`] = 'Diese Gruppe gibt es schon.';
  }

  const vorlageMahlzeiten: string[] = [];
  if (!Array.isArray(value.vorlageMahlzeiten) || value.vorlageMahlzeiten.length === 0) {
    errors.vorlageMahlzeiten = 'Bitte mindestens eine Mahlzeit eintragen.';
  } else if (value.vorlageMahlzeiten.length > 20) {
    errors.vorlageMahlzeiten = 'Höchstens 20 Mahlzeiten.';
  } else {
    value.vorlageMahlzeiten.forEach((item: unknown, index) => {
      vorlageMahlzeiten.push(readName(item, 50, errors, `vorlageMahlzeiten.${index}`));
    });
    const duplicate = hasDuplicate(vorlageMahlzeiten);
    if (duplicate >= 0) errors[`vorlageMahlzeiten.${duplicate}`] = 'Diese Mahlzeit gibt es schon.';
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return {
    anlegenExtern,
    whitelist,
    aufbewahrungMonate: monate as number,
    wartung,
    vorlageGruppen,
    vorlageMahlzeiten,
  };
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
  const errors: FieldErrors = {};
  const value = isRecord(input) ? input : {};
  const name = readName(value.name, 150, errors, 'name');
  const kategorieId = value.kategorieId;
  if (typeof kategorieId !== 'number' || !Number.isInteger(kategorieId) || kategorieId <= 0) {
    errors.kategorieId = 'Bitte eine Kategorie wählen.';
  }
  const einheitenart = value.einheitenart as EssenEinheitenart;
  if (!EINHEITENARTEN.includes(einheitenart)) errors.einheitenart = 'Bitte eine Einheit wählen.';
  const lebensmittel = readBoolean(value.lebensmittel, errors, 'lebensmittel');
  const abtropfgewicht = readBoolean(value.abtropfgewicht, errors, 'abtropfgewicht');
  if (abtropfgewicht && einheitenart !== 'masse') {
    errors.abtropfgewicht = 'Abtropfgewicht gibt es nur bei Gewicht (g/kg).';
  }
  const readMerkmal = (field: 'vegetarisch' | 'vegan'): boolean | null => {
    const merkmal = value[field];
    if (merkmal === null || merkmal === undefined) return null;
    if (typeof merkmal !== 'boolean') errors[field] = 'Bitte ja, nein oder unbekannt wählen.';
    return merkmal === true;
  };
  let vegetarisch = readMerkmal('vegetarisch');
  let vegan = readMerkmal('vegan');
  if (vegan && vegetarisch !== true) {
    errors.vegan = 'Was vegan ist, ist auch vegetarisch.';
  }
  const merkmaleGeprueft = readBoolean(value.merkmaleGeprueft, errors, 'merkmaleGeprueft');
  const hinweis = typeof value.hinweis === 'string' ? value.hinweis.trim() : '';
  if (hinweis.length > 200) errors.hinweis = 'Höchstens 200 Zeichen.';
  let allergene: number[] = [];
  if (!Array.isArray(value.allergene)) errors.allergene = 'Bitte eine Liste angeben.';
  else {
    allergene = [...new Set(value.allergene)].filter(
      (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
    );
    if (allergene.length !== value.allergene.length) errors.allergene = 'Ungültige Auswahl.';
  }
  const grammProTl = readGramm(value.grammProTl, errors, 'grammProTl');
  const grammProEl = readGramm(value.grammProEl, errors, 'grammProEl');
  const grammProStueck = readGramm(value.grammProStueck, errors, 'grammProStueck');
  if (Object.keys(errors).length) throw new ValidationError(errors);

  // Things that are not eaten have no diet and no allergens
  if (!lebensmittel) {
    vegetarisch = null;
    vegan = null;
    allergene = [];
  }
  return {
    name,
    kategorieId: kategorieId as number,
    einheitenart,
    abtropfgewicht,
    lebensmittel,
    vegetarisch,
    vegan,
    merkmaleGeprueft,
    hinweis,
    grammProTl,
    grammProEl,
    grammProStueck,
    allergene,
  };
}

export function validateListName(input: unknown): string {
  const errors: FieldErrors = {};
  const name = readName(isRecord(input) ? input.name : undefined, 100, errors, 'name');
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return name;
}
