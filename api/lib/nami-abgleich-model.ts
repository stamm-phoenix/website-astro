/**
 * The answer of `GET /api/intern/nami-abgleich`, shared with the frontend as types only
 * (`docs/nami-abgleich.md`). Keep it free of imports and runtime code.
 */

/** A person of one of the two lists, reduced to what the comparison shows. */
export interface AbgleichPerson {
  /** NaMi's member id or CampFlow's person id (`per_…`). */
  id: string;
  vorname: string;
  nachname: string;
  geburtsdatum: string | null;
  mitgliedsnummer: string;
  /** Whether the person is a current member of this list. */
  aktiv: boolean;
  /** The Stufe in NaMi or the groups in CampFlow, for the list rows. */
  gruppen: string[];
}

/** One compared field of a linked pair; values are formatted for display, `''` when empty. */
export interface AbgleichFeld {
  feld: AbgleichFeldName;
  label: string;
  nami: string;
  campflow: string;
  gleich: boolean;
}

export type AbgleichFeldName =
  | 'vorname'
  | 'nachname'
  | 'geburtsdatum'
  | 'geschlecht'
  | 'mitgliedsnummer'
  | 'status'
  | 'eintritt'
  | 'austritt'
  | 'stufe'
  | 'email'
  | 'telefon'
  | 'strasse'
  | 'plz'
  | 'ort';

/**
 * How a pair was found: the same Mitgliedsnummer, the same name and birthday, or (to be checked
 * by a person) the same birthday and one of the names, or the same name alone.
 */
export type AbgleichVerbindung = 'mitgliedsnummer' | 'name-geburtsdatum' | 'geburtsdatum' | 'name';

export interface AbgleichPaar {
  nami: AbgleichPerson;
  campflow: AbgleichPerson;
  verbindung: AbgleichVerbindung;
  felder: AbgleichFeld[];
}

export interface NamiAbgleichData {
  namiLoadedAt: string;
  campflowLoadedAt: string;
  paare: AbgleichPaar[];
  nurNami: AbgleichPerson[];
  nurCampflow: AbgleichPerson[];
}
