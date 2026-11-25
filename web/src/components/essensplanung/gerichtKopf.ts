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

/** What leaving or Enter does with a field. */
export type Schritt = 'nichts' | 'konflikt' | 'senden';

/**
 * Decides for one field: `eingabe` is the input, `basis` the saved value it was typed on,
 * `aktuell` the value of the dish now. Input equal to its basis has nothing to save (a warning
 * about it goes); a change of others to this very field, or a warning still standing, waits for
 * „Trotzdem speichern“ (`bewusst`).
 */
export function schritt(
  eingabe: unknown,
  basis: unknown,
  aktuell: unknown,
  { konflikt, bewusst }: { konflikt: boolean; bewusst: boolean }
): Schritt {
  if (gleich(eingabe, basis)) return 'nichts';
  if (bewusst) return 'senden';
  if (konflikt || !gleich(aktuell, basis)) return 'konflikt';
  return 'senden';
}

/**
 * After a refused save: a change of others to this field is a conflict; one to another field
 * only gave the dish a new version, so the field is sent once more with it. Otherwise (no
 * connection, a refused value) the input stays with its error.
 */
export function nachFehler(
  aktuell: unknown,
  geprueft: unknown,
  etagGesendet: string,
  etagJetzt: string
): 'konflikt' | 'nochmal' | 'fehler' {
  if (!gleich(aktuell, geprueft)) return 'konflikt';
  return etagJetzt !== etagGesendet ? 'nochmal' : 'fehler';
}
