import type { EssenEinheitenart } from './essen-validation';
import type { GerichtEinheit, GerichtLink } from './essen-gerichte-model';
import { EINHEITEN_JE_ART, MAX_LINKS, MAX_WERKZEUGE } from './essen-gerichte-model';
import type { FieldErrors } from './pflege-validation';
import { ValidationError } from './pflege-validation';

/** Checks of the input for dishes and the ingredients of a Planung (`essen-gerichte-model.ts`). */

const MAX_MENGE = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(errors: FieldErrors): void {
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

function readLine(value: unknown, max: number, errors: FieldErrors, field: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length > max) errors[field] = `Höchstens ${max} Zeichen.`;
  return text;
}

function readId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function readIds(value: unknown, errors: FieldErrors, field: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => readId(id) === null) || value.length > 30) {
    errors[field] = 'Bitte aus der Liste wählen.';
    return [];
  }
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

/** The fields of a dish; on a change only those sent. */
export interface GerichtInput {
  name?: string;
  personen?: number;
  anleitung?: string;
  notiz?: string;
  links?: GerichtLink[];
  werkzeuge?: string[];
}

function readUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  try {
    const url = new URL(text);
    return (url.protocol === 'https:' || url.protocol === 'http:') && text.length <= 500
      ? text
      : null;
  } catch {
    return null;
  }
}

/** A new dish needs a name and the number of people; a change sends only the changed fields. */
export function validateGericht(input: unknown, { neu }: { neu: boolean }): GerichtInput {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const result: GerichtInput = {};
  if (neu || value.name !== undefined) {
    const name = readLine(value.name, 150, errors, 'name');
    if (!name) errors.name = 'Bitte einen Namen eintragen, z. B. „Chili sin Carne“.';
    result.name = name;
  }
  if (neu || value.personen !== undefined) {
    const personen = value.personen;
    if (typeof personen !== 'number' || !Number.isInteger(personen) || personen < 1) {
      errors.personen = 'Bitte eine ganze Zahl ab 1 eintragen.';
    } else if (personen > 2000) errors.personen = 'Höchstens 2000 Personen.';
    else result.personen = personen;
  }
  if (value.anleitung !== undefined) {
    const anleitung = typeof value.anleitung === 'string' ? value.anleitung.trim() : '';
    if (anleitung.length > 20_000) errors.anleitung = 'Höchstens 20.000 Zeichen.';
    result.anleitung = anleitung;
  }
  if (value.notiz !== undefined) {
    const notiz = typeof value.notiz === 'string' ? value.notiz.trim() : '';
    if (notiz.length > 1000) errors.notiz = 'Höchstens 1000 Zeichen.';
    result.notiz = notiz;
  }
  if (value.links !== undefined) {
    const links: GerichtLink[] = [];
    if (!Array.isArray(value.links) || value.links.length > MAX_LINKS) {
      errors.links = `Höchstens ${MAX_LINKS} Links.`;
    } else {
      value.links.forEach((item: unknown, index) => {
        const link = isRecord(item) ? item : {};
        const url = readUrl(link.url);
        const titel = readLine(link.titel, 100, errors, `links.${index}.titel`);
        if (!url) {
          errors[`links.${index}.url`] = 'Bitte eine Adresse wie https://beispiel.de eintragen.';
        } else links.push({ titel, url });
      });
    }
    result.links = links;
  }
  if (value.werkzeuge !== undefined) {
    const werkzeuge: string[] = [];
    if (!Array.isArray(value.werkzeuge) || value.werkzeuge.length > MAX_WERKZEUGE) {
      errors.werkzeuge = `Höchstens ${MAX_WERKZEUGE} Werkzeuge.`;
    } else {
      value.werkzeuge.forEach((item: unknown) => {
        const name = readLine(item, 100, errors, 'werkzeuge');
        if (name && !werkzeuge.some((w) => w.toLowerCase() === name.toLowerCase()))
          werkzeuge.push(name);
      });
    }
    result.werkzeuge = werkzeuge;
  }
  if (!neu && !Object.keys(result).length && !Object.keys(errors).length) {
    errors.name = 'Es gibt nichts zu speichern.';
  }
  fail(errors);
  return result;
}

/** A line of a dish; the ingredient is a central one or one of the Planung. */
export interface GerichtZutatInput {
  zutat: { zutatId: number } | { planungZutatId: number };
  menge: number | null;
  einheit: GerichtEinheit | null;
  fest: boolean;
  fuerAlles: boolean;
  fuerVegetarisch: boolean;
  fuerVegan: boolean;
  ohne: number[];
  nur: number[];
  hinweis: string;
}

const EINHEITEN = new Set<string>(Object.values(EINHEITEN_JE_ART).flat());

export function validateGerichtZutat(input: unknown): GerichtZutatInput {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const zutatId = readId(value.zutatId);
  const planungZutatId = readId(value.planungZutatId);
  if (!zutatId && !planungZutatId) errors.zutat = 'Bitte eine Zutat wählen.';
  let menge: number | null = null;
  let einheit: GerichtEinheit | null = null;
  if (value.menge !== null && value.menge !== undefined && value.menge !== '') {
    if (typeof value.menge !== 'number' || !Number.isFinite(value.menge) || value.menge <= 0) {
      errors.menge = 'Bitte eine Menge größer als 0 eintragen oder leer lassen.';
    } else if (value.menge > MAX_MENGE) errors.menge = 'Die Menge ist zu groß.';
    else menge = Math.round(value.menge * 1000) / 1000 || 0.001;
    if (typeof value.einheit !== 'string' || !EINHEITEN.has(value.einheit)) {
      errors.einheit = 'Bitte eine Einheit wählen.';
    } else einheit = value.einheit as GerichtEinheit;
  }
  const fuerAlles = value.fuerAlles !== false;
  const fuerVegetarisch = value.fuerVegetarisch !== false;
  const fuerVegan = value.fuerVegan !== false;
  if (!fuerAlles && !fuerVegetarisch && !fuerVegan) {
    errors.fuer = 'Die Zeile muss für mindestens eine Ernährungsform gelten.';
  }
  const ohne = readIds(value.ohne, errors, 'ohne');
  const nur = readIds(value.nur, errors, 'nur');
  if (ohne.some((id) => nur.includes(id))) {
    errors.nur = 'Eine Unverträglichkeit kann nicht zugleich „nicht für“ und „nur für“ sein.';
  }
  const hinweis = readLine(value.hinweis, 100, errors, 'hinweis');
  fail(errors);
  return {
    zutat: zutatId ? { zutatId } : { planungZutatId: planungZutatId! },
    menge,
    einheit,
    fest: value.fest === true && menge !== null,
    fuerAlles,
    fuerVegetarisch,
    fuerVegan,
    ohne,
    nur,
    hinweis,
  };
}

/** Fields of an ingredient of the Planung's own, or the differences of a central one. */
export interface PlanungZutatInput {
  name?: string;
  kategorieId: number | null;
  einheitenart: EssenEinheitenart | null;
  vegetarisch?: boolean | null;
  vegan?: boolean | null;
  allergene?: number[];
}

const ARTEN = new Set<string>(Object.keys(EINHEITEN_JE_ART));

function readMerkmal(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * `eigene`: a new or changed ingredient of the Planung's own with all fields; otherwise the
 * differences of a central ingredient (null: as in the central list).
 */
export function validatePlanungZutat(input: unknown, { eigene }: { eigene: boolean }) {
  const value = isRecord(input) ? input : {};
  const errors: FieldErrors = {};
  const kategorieId = readId(value.kategorieId);
  const einheitenart =
    typeof value.einheitenart === 'string' && ARTEN.has(value.einheitenart)
      ? (value.einheitenart as EssenEinheitenart)
      : null;
  if (!eigene) {
    fail(errors);
    return { kategorieId, einheitenart } satisfies PlanungZutatInput;
  }
  const name = readLine(value.name, 150, errors, 'name');
  if (!name) errors.name = 'Bitte einen Namen eintragen.';
  if (!kategorieId) errors.kategorieId = 'Bitte eine Kategorie wählen.';
  if (!einheitenart) errors.einheitenart = 'Bitte wählen, worin die Zutat gemessen wird.';
  const vegan = readMerkmal(value.vegan);
  // Vegan includes vegetarian, as in the central list
  const vegetarisch = vegan ? true : readMerkmal(value.vegetarisch);
  const allergene = readIds(value.allergene, errors, 'allergene');
  fail(errors);
  return {
    name,
    kategorieId,
    einheitenart,
    vegetarisch,
    vegan,
    allergene,
  } satisfies PlanungZutatInput;
}
