/**
 * Shops, stock and extra needs of the Planungen in the mock API, like `api/lib/essen-einkauf.ts`.
 */
import type { GeschaeftInput, PostenArt, PostenInput } from '../../../api/lib/essen-einkauf-model';
import { MAX_GESCHAEFTE, MAX_POSTEN } from '../../../api/lib/essen-einkauf-model';
import { einheitPasst } from '../../../api/lib/essen-gerichte-model';
import { zutatFuer } from './essensplanung-gerichte';
import type { MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neueId, neuesEtag, nichtGefunden } from './essensplanung-planung';

const gleich = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' }) === 0;

const EINHEITENART_TEXT = {
  masse: 'g oder kg',
  volumen: 'ml oder l',
  stueck: 'Stück',
  packung: 'Packungen',
  bund: 'Bund',
} as const;

function geschaeftVon(z: MockZugang, id: number) {
  const geschaeft = z.planung.geschaefte.find((g) => g.id === id);
  if (!geschaeft) throw nichtGefunden();
  return geschaeft;
}

export function geschaeftAnlegen(z: MockZugang, input: GeschaeftInput): void {
  if (z.planung.geschaefte.length >= MAX_GESCHAEFTE)
    throw feld('name', `Höchstens ${MAX_GESCHAEFTE} Geschäfte.`);
  if (z.planung.geschaefte.some((g) => gleich(g.name, input.name)))
    throw feld('name', 'Dieses Geschäft gibt es in der Planung schon.');
  aendere(z, 'geschaeft-neu', { name: input.name }, () => {
    z.planung.geschaefte.push({
      id: neueId(),
      etag: neuesEtag(),
      position: Math.max(0, ...z.planung.geschaefte.map((g) => g.position)) + 1,
      name: input.name,
    });
  });
}

/** Renames (`input`) or deletes (null) a shop; its ingredients are then bought at none. */
export function geschaeftAendern(
  z: MockZugang,
  id: number,
  input: GeschaeftInput | null,
  ifMatch: unknown
): void {
  const geschaeft = geschaeftVon(z, id);
  if (input && z.planung.geschaefte.some((g) => g !== geschaeft && gleich(g.name, input.name)))
    throw feld('name', 'Dieses Geschäft gibt es in der Planung schon.');
  if (geschaeft.etag !== ifMatch) throw konflikt();
  if (!input) {
    aendere(z, 'geschaeft-geloescht', { name: geschaeft.name }, () => {
      for (const zutat of z.planung.zutaten)
        if (zutat.geschaeftId === id)
          Object.assign(zutat, { geschaeftId: null, etag: neuesEtag() });
      z.planung.geschaefte.splice(z.planung.geschaefte.indexOf(geschaeft), 1);
    });
    return;
  }
  const details = {
    name: input.name,
    ...(geschaeft.name !== input.name ? { vorher: geschaeft.name } : {}),
  };
  aendere(z, 'geschaeft-geaendert', details, () => {
    Object.assign(geschaeft, input, { etag: neuesEtag() });
  });
}

export function zutatGeschaeft(z: MockZugang, planungZutatId: number, geschaeftId: number | null) {
  const zutat = z.planung.zutaten.find((entry) => entry.id === planungZutatId);
  if (!zutat) throw nichtGefunden();
  const geschaeft =
    geschaeftId === null ? null : z.planung.geschaefte.find((g) => g.id === geschaeftId);
  if (geschaeft === undefined) throw feld('geschaeftId', 'Dieses Geschäft gibt es nicht mehr.');
  const name = zutatFuer(z, { planungZutatId }, { lebensmittel: false }).name;
  aendere(z, 'zutat-geschaeft', { name, geschaeft: geschaeft?.name ?? null }, () => {
    Object.assign(zutat, { geschaeftId, etag: neuesEtag() });
  });
}

function postenZutat(z: MockZugang, input: PostenInput) {
  const zutat = zutatFuer(z, input.zutat, { lebensmittel: false });
  if (!einheitPasst(zutat.einheitenart, input.einheit))
    throw feld(
      'einheit',
      `${zutat.name} wird in ${EINHEITENART_TEXT[zutat.einheitenart]} gemessen.`
    );
  return zutat;
}

export function postenAnlegen(z: MockZugang, art: PostenArt, input: PostenInput): void {
  if (z.planung[art].length >= MAX_POSTEN) throw feld('zutat', `Höchstens ${MAX_POSTEN} Einträge.`);
  const zutat = postenZutat(z, input);
  aendere(z, `${art}-neu`, { name: zutat.name }, () => {
    z.planung[art].push({
      id: neueId(),
      etag: neuesEtag(),
      planungZutatId: zutat.id,
      menge: input.menge,
      einheit: input.einheit,
      hinweis: input.hinweis,
    });
  });
}

/** Changes (`input`) or deletes (null) an entry of stock or extra needs. */
export function postenAendern(
  z: MockZugang,
  art: PostenArt,
  id: number,
  input: PostenInput | null,
  ifMatch: unknown
): void {
  const posten = z.planung[art].find((p) => p.id === id);
  if (!posten) throw nichtGefunden();
  if (!input) {
    if (posten.etag !== ifMatch) throw konflikt();
    const name = zutatFuer(
      z,
      { planungZutatId: posten.planungZutatId },
      { lebensmittel: false }
    ).name;
    aendere(z, `${art}-geloescht`, { name }, () => {
      z.planung[art].splice(z.planung[art].indexOf(posten), 1);
    });
    return;
  }
  const zutat = postenZutat(z, input);
  if (posten.etag !== ifMatch) throw konflikt();
  aendere(z, `${art}-geaendert`, { name: zutat.name }, () => {
    Object.assign(posten, {
      planungZutatId: zutat.id,
      menge: input.menge,
      einheit: input.einheit,
      hinweis: input.hinweis,
      etag: neuesEtag(),
    });
  });
}
