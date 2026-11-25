/**
 * The details of an ingredient of the Planung's own that was added by its name alone
 * (`docs/essensplanung.md`, „Zutaten schnell anlegen“): the category and the kind of unit get a
 * stand-in, the diet and allergens stay unknown, and the AI fills in what is open afterwards.
 * Without imports, so the website may use it too.
 */

/** The details the AI fills in. */
export const ZUTAT_ANGABEN = ['kategorie', 'einheitenart', 'merkmale'] as const;
export type ZutatAngabe = (typeof ZUTAT_ANGABEN)[number];

/**
 * How far they are: `offen` while the AI has not filled them in (the category and kind of unit
 * are stand-ins), `ki` once it did, until someone saves them; `geprueft` otherwise, also for
 * central ingredients and all added before.
 */
export type ZutatAngabenStand = 'geprueft' | 'offen' | 'ki';

/** `angaben_offen` as stored: the details in their order, comma-separated; null for none. */
export function angabenText(angaben: readonly ZutatAngabe[]): string | null {
  const liste = ZUTAT_ANGABEN.filter((angabe) => angaben.includes(angabe));
  return liste.length ? liste.join(',') : null;
}

/** The details of `angaben_offen`; unknown words are skipped. */
export function angabenListe(text: string | null): ZutatAngabe[] {
  const teile = (text ?? '').split(',');
  return ZUTAT_ANGABEN.filter((angabe) => teile.includes(angabe));
}

export function angabenStand(offen: string | null, geprueft: boolean): ZutatAngabenStand {
  if (angabenListe(offen).length) return 'offen';
  return geprueft ? 'geprueft' : 'ki';
}
