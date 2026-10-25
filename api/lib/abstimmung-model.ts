/**
 * Abstimmungen (`docs/abstimmungen.md`): types, input checks and the result shared by the API,
 * the mock API and the pages. Free of Node and browser APIs, like the other shared models.
 */
import { ValidationError } from './pflege-validation';

export type AbstimmungMailArt = 'einladung' | 'erinnerung';
export type AbstimmungMailStatus = 'offen' | 'versucht' | 'gesendet';

/**
 * Who sees who chose what: `offen` everyone who votes; `anonym` only the organizer, the others
 * see who answered; `geheim` only the organizer, the others see only how many answered.
 */
export type AbstimmungSichtbarkeit = 'offen' | 'anonym' | 'geheim';
export const ABSTIMMUNG_SICHTBARKEITEN: readonly AbstimmungSichtbarkeit[] = [
  'offen',
  'anonym',
  'geheim',
];

/** What someone sees of the answers of others: everything, only the names, only the number. */
export type AbstimmungEinsicht = 'alles' | 'namen' | 'anzahl';

/** The organizer sees everything; everyone else what the Sichtbarkeit allows. */
export function abstimmungEinsicht(
  sichtbarkeit: AbstimmungSichtbarkeit,
  organisator: boolean
): AbstimmungEinsicht {
  if (organisator || sichtbarkeit === 'offen') return 'alles';
  return sichtbarkeit === 'anonym' ? 'namen' : 'anzahl';
}

/** Most options of one Abstimmung; more do not fit on a phone. */
export const MAX_ABSTIMMUNG_OPTIONEN = 40;
/** Most people per Abstimmung, so a shared link cannot fill the table. */
export const MAX_ABSTIMMUNG_TEILNAHMEN = 300;

export interface AbstimmungOption {
  id: number;
  text: string;
  /** How many people chose it with „Ja“. */
  stimmen: number;
  /** How many people chose it with „Vielleicht“. */
  vielleicht: number;
}

/**
 * The answer of one person, with the IDs of the options chosen with „Ja“ and „Vielleicht“
 * (none: no option fits). Both are empty when the viewer may only see who answered.
 */
export interface AbstimmungAntwort {
  name: string;
  gewaehlt: number[];
  vielleicht: number[];
}

/** What everyone who may vote sees: question, options with counts and the answers. */
export interface AbstimmungErgebnis {
  id: number;
  titel: string;
  beschreibung: string;
  /** At most this many options with „Ja“, e.g. 1 for a single choice; `null`: any number. */
  maxAuswahl: number | null;
  /** Options may also be chosen with „Vielleicht“. */
  vielleichtErlaubt: boolean;
  sichtbarkeit: AbstimmungSichtbarkeit;
  /** What the viewer sees of the answers of others; decides what `antworten` holds. */
  einsicht: AbstimmungEinsicht;
  geschlossen: boolean;
  erstelltVonName: string;
  optionen: AbstimmungOption[];
  /** `alles`: names and choices; `namen`: names without choices; `anzahl`: empty. */
  antworten: AbstimmungAntwort[];
  /** How many people answered. */
  anzahlAntworten: number;
}

/** The own answer; `null` before someone who came over the shared link entered a name. */
export interface AbstimmungIch {
  name: string;
  gewaehlt: number[];
  vielleicht: number[];
  geantwortet: boolean;
}

/** Answer of the public endpoint. */
export interface AbstimmungAnsicht extends AbstimmungErgebnis {
  ich: AbstimmungIch | null;
}

/** A person invited or answering, as the organizer sees it. */
export interface AbstimmungTeilnahme {
  id: number;
  name: string;
  /** Address the invitation went to; empty for people who never got a mail. */
  email: string;
  geantwortet: boolean;
  eingeladenAm: string | null;
  erinnertAm: string | null;
  /** State of the last mail; `versucht` means unclear whether it arrived. */
  mailStatus: AbstimmungMailStatus | null;
}

/** Answer of the staff detail endpoint. */
export interface AbstimmungDetail extends AbstimmungAnsicht {
  etag: string;
  erstelltAm: string;
  /** The logged-in person created it and manages it. */
  eigene: boolean;
  /** Shared invitation link; only for the organizer. */
  link: string | null;
  /** Everyone invited or answering; only for the organizer. */
  teilnahmen: AbstimmungTeilnahme[] | null;
}

/** An entry of the staff list. */
export interface AbstimmungUebersicht {
  id: number;
  titel: string;
  geschlossen: boolean;
  erstelltVonName: string;
  erstelltAm: string;
  eigene: boolean;
  /** People who answered. */
  antworten: number;
  /** The logged-in person answered already. */
  ichGeantwortet: boolean;
}

/** An option as written in the form; `id` keeps an existing one and its votes. */
export interface AbstimmungOptionEingabe {
  id?: number;
  text: string;
}

export interface AbstimmungEingabe {
  titel: string;
  beschreibung: string;
  maxAuswahl: number | null;
  vielleichtErlaubt: boolean;
  sichtbarkeit: AbstimmungSichtbarkeit;
  optionen: AbstimmungOptionEingabe[];
  /**
   * Votes per option ID as the form showed them; an option removed now may lose at most these,
   * so a vote cast meanwhile is never deleted without a warning.
   */
  bekannteStimmen: Record<number, number>;
}

function text(value: unknown, field: string, max: number, label: string, optional = false): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' && !(optional && (value === undefined || value === null))) {
    throw new ValidationError({ [field]: `${label} fehlt.` });
  }
  if (!optional && !trimmed) throw new ValidationError({ [field]: `${label} fehlt.` });
  if (trimmed.length > max) {
    throw new ValidationError({ [field]: `${label} darf höchstens ${max} Zeichen haben.` });
  }
  return trimmed;
}

/** Checks title, description, mode and options of the form. */
export function validateAbstimmung(body: Record<string, unknown> | null): AbstimmungEingabe {
  if (!body) throw new ValidationError({ form: 'Bitte prüfe die Eingaben.' });
  const titel = text(body.titel, 'titel', 200, 'Die Frage');
  const beschreibung = text(body.beschreibung, 'beschreibung', 2000, 'Die Beschreibung', true);
  const max = body.maxAuswahl;
  if (
    max !== undefined &&
    max !== null &&
    (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > MAX_ABSTIMMUNG_OPTIONEN)
  ) {
    throw new ValidationError({ maxAuswahl: 'Bitte wähle, wie viele Optionen man wählen kann.' });
  }
  if (body.vielleichtErlaubt !== undefined && typeof body.vielleichtErlaubt !== 'boolean') {
    throw new ValidationError({ vielleichtErlaubt: 'Bitte wähle, ob „Vielleicht“ möglich ist.' });
  }
  const sichtbarkeit = body.sichtbarkeit ?? 'offen';
  if (!ABSTIMMUNG_SICHTBARKEITEN.includes(sichtbarkeit as AbstimmungSichtbarkeit)) {
    throw new ValidationError({ sichtbarkeit: 'Bitte wähle, wer die Antworten sieht.' });
  }
  if (!Array.isArray(body.optionen)) {
    throw new ValidationError({ optionen: 'Bitte trag mindestens zwei Optionen ein.' });
  }
  const optionen: AbstimmungOptionEingabe[] = [];
  const texte = new Set<string>();
  const ids = new Set<number>();
  for (const value of body.optionen) {
    const entry = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const option = text(entry.text, 'optionen', 200, 'Der Text einer Option', true);
    // Empty rows of the form are left out instead of blocking the save
    if (!option) continue;
    const key = option.toLocaleLowerCase('de');
    if (texte.has(key)) {
      throw new ValidationError({ optionen: `Die Option „${option}“ steht zweimal in der Liste.` });
    }
    texte.add(key);
    const id = entry.id;
    if (id !== undefined && id !== null) {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || ids.has(id)) {
        throw new ValidationError({ optionen: 'Die Liste der Optionen ist ungültig.' });
      }
      ids.add(id);
      optionen.push({ id, text: option });
    } else {
      optionen.push({ text: option });
    }
  }
  if (optionen.length < 2) {
    throw new ValidationError({ optionen: 'Bitte trag mindestens zwei Optionen ein.' });
  }
  if (optionen.length > MAX_ABSTIMMUNG_OPTIONEN) {
    throw new ValidationError({
      optionen: `Höchstens ${MAX_ABSTIMMUNG_OPTIONEN} Optionen. Bitte nimm welche heraus.`,
    });
  }
  const bekannteStimmen: Record<number, number> = {};
  const stimmen = body.bekannteStimmen;
  if (stimmen && typeof stimmen === 'object' && !Array.isArray(stimmen)) {
    for (const [key, value] of Object.entries(stimmen)) {
      if (/^\d{1,9}$/.test(key) && Number.isInteger(value) && (value as number) >= 0)
        bekannteStimmen[Number(key)] = value as number;
    }
  }
  return {
    titel,
    beschreibung,
    maxAuswahl: typeof max === 'number' ? max : null,
    vielleichtErlaubt: body.vielleichtErlaubt === true,
    sichtbarkeit: sichtbarkeit as AbstimmungSichtbarkeit,
    optionen,
    bekannteStimmen,
  };
}

/** The name someone enters over the shared link. */
export function validateAbstimmungName(value: unknown): string {
  return text(value, 'name', 100, 'Dein Name').replace(/\s+/g, ' ');
}

/** The rules an answer must follow. */
export interface AbstimmungRegeln {
  optionIds: readonly number[];
  maxAuswahl: number | null;
  vielleichtErlaubt: boolean;
}

/** „Hier kannst du nur eine Option wählen.“ or „… höchstens 3 Optionen …“. */
export function maxAuswahlText(max: number): string {
  return max === 1
    ? 'Hier kannst du nur eine Option wählen.'
    : `Hier kannst du höchstens ${max} Optionen mit „Ja“ wählen.`;
}

/**
 * The chosen options: existing IDs, each once and either with „Ja“ or „Vielleicht“, at most
 * `maxAuswahl` with „Ja“ (any number with „Vielleicht“). Empty lists are an answer too: none of
 * the options fits.
 */
export function validateAntwort(
  gewaehltValue: unknown,
  vielleichtValue: unknown,
  regeln: AbstimmungRegeln
): { gewaehlt: number[]; vielleicht: number[] } {
  const { optionIds, maxAuswahl, vielleichtErlaubt } = regeln;
  const known = new Set(optionIds);
  const read = (value: unknown): Set<number> => {
    if (!Array.isArray(value) || value.length > optionIds.length) {
      throw new ValidationError({
        gewaehlt: 'Die Auswahl ist ungültig. Bitte lade die Seite neu.',
      });
    }
    const chosen = new Set<number>();
    for (const id of value) {
      if (typeof id !== 'number' || !known.has(id)) {
        throw new ValidationError({
          gewaehlt: 'Eine Option gibt es nicht mehr. Bitte lade die Seite neu.',
        });
      }
      chosen.add(id);
    }
    return chosen;
  };
  const ja = read(gewaehltValue);
  const vielleicht = read(vielleichtValue ?? []);
  if (vielleicht.size > 0 && !vielleichtErlaubt) {
    throw new ValidationError({
      gewaehlt: '„Vielleicht“ geht bei dieser Abstimmung nicht mehr. Bitte lade die Seite neu.',
    });
  }
  if ([...vielleicht].some((id) => ja.has(id))) {
    throw new ValidationError({ gewaehlt: 'Die Auswahl ist ungültig. Bitte lade die Seite neu.' });
  }
  if (maxAuswahl !== null && ja.size > maxAuswahl) {
    throw new ValidationError({ gewaehlt: maxAuswahlText(maxAuswahl) });
  }
  return {
    gewaehlt: optionIds.filter((id) => ja.has(id)),
    vielleicht: optionIds.filter((id) => vielleicht.has(id)),
  };
}

/** Row data the result is built from. */
export interface AbstimmungRohdaten {
  id: number;
  titel: string;
  beschreibung: string;
  maxAuswahl: number | null;
  vielleichtErlaubt: boolean;
  sichtbarkeit: AbstimmungSichtbarkeit;
  geschlossen: boolean;
  erstelltVonName: string;
  optionen: { id: number; text: string }[];
  /** Everyone who answered, in the order of their first answer. */
  antworten: { teilnahmeId: number; name: string; gewaehlt: number[]; vielleicht: number[] }[];
}

/** Counts the votes per option; the answers only as far as `einsicht` allows. */
export function abstimmungErgebnis(
  daten: AbstimmungRohdaten,
  einsicht: AbstimmungEinsicht
): AbstimmungErgebnis {
  const zaehlen = (pick: (antwort: AbstimmungRohdaten['antworten'][number]) => number[]) => {
    const counts = new Map<number, number>();
    for (const antwort of daten.antworten) {
      for (const id of pick(antwort)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };
  const ja = zaehlen((antwort) => antwort.gewaehlt);
  const vielleicht = zaehlen((antwort) => antwort.vielleicht);
  return {
    id: daten.id,
    titel: daten.titel,
    beschreibung: daten.beschreibung,
    maxAuswahl: daten.maxAuswahl,
    vielleichtErlaubt: daten.vielleichtErlaubt,
    sichtbarkeit: daten.sichtbarkeit,
    einsicht,
    geschlossen: daten.geschlossen,
    erstelltVonName: daten.erstelltVonName,
    optionen: daten.optionen.map((option) => ({
      ...option,
      stimmen: ja.get(option.id) ?? 0,
      vielleicht: vielleicht.get(option.id) ?? 0,
    })),
    antworten:
      einsicht === 'anzahl'
        ? []
        : daten.antworten.map(({ name, gewaehlt, vielleicht: auch }) =>
            einsicht === 'alles'
              ? { name, gewaehlt, vielleicht: auch }
              : { name, gewaehlt: [], vielleicht: [] }
          ),
    anzahlAntworten: daten.antworten.length,
  };
}
