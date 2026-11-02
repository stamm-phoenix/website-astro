/**
 * The packing list of a Planung (`docs/essensplanung.md`, Packliste): the tools of the planned
 * dishes, merged by name, and entries of its own, each with the persons who pack it (each with
 * their own box) and whether it is packed. Without zod, so the page uses it too; the checks of
 * the requests are in `essen-packliste-validation.ts`.
 */

/** Entries of its own per Planung. */
export const MAX_PACKLISTE = 300;
/** Length of a name, as of a tool of a dish. */
export const MAX_PACK_NAME = 100;
/**
 * Length of a merged name (`packliste_eintrag.werkzeug`): lower case may lengthen a character
 * („İ“ becomes „i̇“, two UTF-16 units), never by more than one unit per character.
 */
export const MAX_PACK_SCHLUESSEL = 2 * MAX_PACK_NAME;
/** Persons named in one change, and free names per entry. */
export const MAX_PACK_PERSONEN = 50;

/** A person who packs an entry, with their own box. */
export interface PackZuteilung {
  id: number;
  etag: string;
  /** A member of the Planung, or null for a free name. */
  mitgliedId: number | null;
  /** The member's current name, or the free name. */
  name: string;
  gepackt: boolean;
}

/** A stored entry: the state of a tool of the dishes, or a thing of its own. */
export interface PacklisteEintrag {
  id: number;
  etag: string;
  /** The merged name of a tool (`packlisteSchluessel`); null for an entry of its own. */
  werkzeug: string | null;
  /** The shown name: the entry's own, or the tool's as it was first set. */
  name: string;
  /** The whole entry: its one box, or with persons whether all of them packed. */
  gepackt: boolean;
  /** Who packs it, in the order they were added; empty for nobody. */
  zuteilungen: PackZuteilung[];
}

/** Persons to assign: members of the Planung and free names. */
export interface PackPersonen {
  mitglieder: number[];
  namen: string[];
}

/** A new entry of its own, with who packs it. */
export interface PackEintragInput extends PackPersonen {
  name: string;
}

/**
 * The fields of an entry that someone changed; at least one. Persons are added (`hinzu`) and
 * taken off (`weg`, ids of assignments) as a difference, so changes of several people merge.
 */
export interface PackAenderung {
  gepackt?: boolean;
  hinzu?: PackPersonen;
  weg?: number[];
}

/** The state of a tool of the dishes, set by its name. */
export interface WerkzeugAenderung extends PackAenderung {
  werkzeug: string;
}

/** Packs or unpacks one person's share of an entry. */
export interface ZuteilungAenderung {
  gepackt: boolean;
}

/**
 * The name tools are merged by: trimmed, inner whitespace collapsed, lower case. „Großer Topf“
 * and „ großer  topf“ are the same thing to pack.
 */
export function packlisteSchluessel(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}
