/**
 * The packing list of a Planung (`docs/essensplanung.md`, Packliste): the tools of the planned
 * dishes, merged by name, and entries of its own, each with who packs it and whether it is
 * packed. Without zod, so the page uses it too; the checks of the requests are in
 * `essen-packliste-validation.ts`.
 */

/** Entries of its own per Planung. */
export const MAX_PACKLISTE = 300;
/** Length of a name, as of a tool of a dish. */
export const MAX_PACK_NAME = 100;

/** A stored entry: the state of a tool of the dishes, or a thing of its own. */
export interface PacklisteEintrag {
  id: number;
  etag: string;
  /** The merged name of a tool (`packlisteSchluessel`); null for an entry of its own. */
  werkzeug: string | null;
  /** The shown name: the entry's own, or the tool's as it was first set. */
  name: string;
  gepackt: boolean;
  /** A member of the Planung, or null. */
  zustaendigId: number | null;
  /** The shown name of who packs it: the member's or a free one; empty for nobody. */
  zustaendig: string;
}

/** Who packs a thing: a member or a free name (or nobody, both empty). */
export interface PackZustaendig {
  zustaendigId: number | null;
  zustaendigText: string;
}

/** A new entry of its own. */
export interface PackEintragInput extends PackZustaendig {
  name: string;
}

/** The fields of an entry that someone changed; at least one. */
export interface PackAenderung {
  gepackt?: boolean;
  zustaendig?: PackZustaendig;
}

/** The state of a tool of the dishes, set by its name. */
export interface WerkzeugAenderung extends PackAenderung {
  werkzeug: string;
}

/**
 * The name tools are merged by: trimmed, inner whitespace collapsed, lower case. „Großer Topf“
 * and „ großer  topf“ are the same thing to pack.
 */
export function packlisteSchluessel(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}
