/**
 * Abstimmungen (`docs/abstimmungen.md`): types and the result shared by the API,
 * the mock API and the pages. Free of Node, browser APIs and zod (the input checks are in
 * `abstimmung-schema.ts`), like the other shared models.
 */

export type AbstimmungMailArt = 'einladung' | 'erinnerung';
export type AbstimmungMailStatus = 'offen' | 'versucht' | 'gesendet';

/**
 * Who sees who chose what: `offen` everyone who votes; `anonym` only the organizer, the others
 * see who answered; `geheim` only the organizer, the others see only how many answered.
 */
export type AbstimmungSichtbarkeit = 'offen' | 'anonym' | 'geheim';
export const ABSTIMMUNG_SICHTBARKEITEN = [
  'offen',
  'anonym',
  'geheim',
] as const satisfies readonly AbstimmungSichtbarkeit[];

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
/**
 * Answers needed before people who may not see who chose what see the votes per option; with
 * fewer, the counts would show a single person's choice.
 */
export const MIN_ANTWORTEN_FUER_ZAHLEN = 3;
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
  /**
   * The votes per option are held back (all 0) until `MIN_ANTWORTEN_FUER_ZAHLEN` answered,
   * for everyone who may not see who chose what.
   */
  zahlenVerborgen: boolean;
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
  const zahlenVerborgen =
    einsicht !== 'alles' && daten.antworten.length < MIN_ANTWORTEN_FUER_ZAHLEN;
  const ja = zahlenVerborgen ? new Map<number, number>() : zaehlen((antwort) => antwort.gewaehlt);
  const vielleicht = zahlenVerborgen
    ? new Map<number, number>()
    : zaehlen((antwort) => antwort.vielleicht);
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
    zahlenVerborgen,
  };
}
