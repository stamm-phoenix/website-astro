import type { Gericht, GerichtLink } from '../../../../api/lib/essen-gerichte-model';

/** The fields of a dish as the form holds them (`GerichtKopf.svelte`). */
export interface Kopf {
  name: string;
  personen: string;
  anleitung: string;
  notiz: string;
  werkzeuge: string[];
  links: GerichtLink[];
}

export type KopfFeld = keyof Kopf;

/** Each saves on its own. */
export const KOPF_FELDER: readonly KopfFeld[] = [
  'name',
  'personen',
  'anleitung',
  'notiz',
  'werkzeuge',
  'links',
];

/** Names of the fields in messages, e.g. about lost input. */
export const FELD_NAMEN: Record<KopfFeld, string> = {
  name: 'Name',
  personen: 'Personen',
  anleitung: 'Anleitung',
  notiz: 'Notiz',
  werkzeuge: 'Werkzeuge',
  links: 'Links',
};

export function kopfVon(gericht: Gericht): Kopf {
  return {
    name: gericht.name,
    personen: gericht.personen === null ? '' : String(gericht.personen),
    anleitung: gericht.anleitung,
    notiz: gericht.notiz,
    werkzeuge: [...gericht.werkzeuge],
    links: gericht.links.map((link) => ({ ...link })),
  };
}

export function gleich(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A field as text, e.g. „Topf, Kelle“ for the tools. */
export function textVon(wert: Kopf[KopfFeld]): string {
  if (typeof wert === 'string') return wert;
  return wert.map((eintrag) => (typeof eintrag === 'string' ? eintrag : eintrag.url)).join(', ');
}
