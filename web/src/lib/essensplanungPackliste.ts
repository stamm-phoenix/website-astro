import { packlisteSchluessel } from '../../../api/lib/essen-packliste-model';
import { einplanungKennung } from './essensplanungEinplanung';
import type { PacklisteEintrag, PlanungAnsicht, PlanungMitglied } from './types';

/**
 * The packing list of a Planung (`docs/essensplanung.md`, Packliste): the tools of all planned
 * dishes, merged by name (`packlisteSchluessel`), with the dishes and planned meals that need
 * them, and the entries of its own. What someone set at a tool comes from its stored row.
 */

/** A dish that needs a tool, with the IDs of its planned meals, e.g. `3_2_1`. */
export interface PackGericht {
  id: number;
  name: string;
  kennungen: string[];
}

/** One thing to pack. */
export interface PackZeile {
  /** Unique in the list: `w:<merged name>` for a tool, `e:<id>` for an entry of its own. */
  key: string;
  /** The merged name of a tool; null for an entry of its own. */
  werkzeug: string | null;
  name: string;
  /** The stored row; null while nobody set anything at this tool. */
  eintrag: PacklisteEintrag | null;
  gepackt: boolean;
  zustaendigId: number | null;
  zustaendig: string;
  /** The dishes that need it, in the order of the plan; empty for an entry of its own. */
  gerichte: PackGericht[];
}

const VERGLEICH = new Intl.Collator('de');

/** All things to pack, by name. Tools of dishes that are not planned are left out. */
export function packliste(
  ansicht: Pick<PlanungAnsicht, 'tage' | 'gerichte' | 'packliste'>
): PackZeile[] {
  const gerichte = new Map(ansicht.gerichte.map((gericht) => [gericht.id, gericht]));
  const werkzeuge = new Map<string, { name: string; gerichte: Map<number, PackGericht> }>();
  for (const tag of ansicht.tage) {
    for (const mahlzeit of tag.mahlzeiten) {
      for (const einplanung of mahlzeit.einplanungen) {
        const gericht = gerichte.get(einplanung.gerichtId);
        if (!gericht) continue;
        const kennung = einplanungKennung(mahlzeit, einplanung.id);
        // A dish naming a tool twice („Topf“, „topf“) counts once
        const schluessel = new Set<string>();
        for (const name of gericht.werkzeuge) {
          const key = packlisteSchluessel(name);
          if (!key || schluessel.has(key)) continue;
          schluessel.add(key);
          const werkzeug = werkzeuge.get(key) ?? { name: name.trim(), gerichte: new Map() };
          const eintrag = werkzeug.gerichte.get(gericht.id) ?? {
            id: gericht.id,
            name: gericht.name,
            kennungen: [],
          };
          eintrag.kennungen.push(kennung);
          werkzeug.gerichte.set(gericht.id, eintrag);
          werkzeuge.set(key, werkzeug);
        }
      }
    }
  }
  const gespeichert = new Map(
    ansicht.packliste
      .filter((eintrag) => eintrag.werkzeug !== null)
      .map((eintrag) => [eintrag.werkzeug!, eintrag])
  );
  const zustand = (eintrag: PacklisteEintrag | null) => ({
    eintrag,
    gepackt: eintrag?.gepackt ?? false,
    zustaendigId: eintrag?.zustaendigId ?? null,
    zustaendig: eintrag?.zustaendig ?? '',
  });
  const zeilen: PackZeile[] = [
    ...[...werkzeuge].map(([key, werkzeug]) => ({
      key: `w:${key}`,
      werkzeug: key,
      name: werkzeug.name,
      ...zustand(gespeichert.get(key) ?? null),
      gerichte: [...werkzeug.gerichte.values()],
    })),
    ...ansicht.packliste
      .filter((eintrag) => eintrag.werkzeug === null)
      .map((eintrag) => ({
        key: `e:${eintrag.id}`,
        werkzeug: null,
        name: eintrag.name,
        ...zustand(eintrag),
        gerichte: [],
      })),
  ];
  return zeilen.sort((a, b) => VERGLEICH.compare(a.name, b.name));
}

/** „Chili (1_2_1, 2_2_1) · Suppe (1_3_1)“; empty for an entry of its own. */
export function fuerText(zeile: Pick<PackZeile, 'gerichte'>): string {
  return zeile.gerichte
    .map((gericht) => `${gericht.name} (${gericht.kennungen.join(', ')})`)
    .join(' · ');
}

export type PackFilter = 'alle' | 'offen' | 'gepackt' | 'meine';

/** The things a filter of the page shows; „meine“ are those `ichId` packs. */
export function gefiltert(
  zeilen: PackZeile[],
  filter: PackFilter,
  ichId: number | null
): PackZeile[] {
  if (filter === 'offen') return zeilen.filter((zeile) => !zeile.gepackt);
  if (filter === 'gepackt') return zeilen.filter((zeile) => zeile.gepackt);
  if (filter === 'meine')
    return zeilen.filter((zeile) => ichId !== null && zeile.zustaendigId === ichId);
  return zeilen;
}

/** One row of the PDF: packed, what, for which dishes, who packs it. */
export interface PackDruckZeile {
  gepackt: boolean;
  name: string;
  fuer: string;
  zustaendig: string;
}

export function packlisteDruck(zeilen: PackZeile[]): PackDruckZeile[] {
  return zeilen.map((zeile) => ({
    gepackt: zeile.gepackt,
    name: zeile.name,
    fuer: fuerText(zeile),
    zustaendig: zeile.zustaendig,
  }));
}

/**
 * The id of a row's elements. Encodes the whole key, so „Grill-Zange“ and „Grill Zange“, two
 * rows of the list, never share a box and its label.
 */
export function packId(key: string): string {
  return `pack-${encodeURIComponent(key)}`;
}

/**
 * The members to choose who packs a thing: those with access, and the one responsible now even
 * without access. Others with a read link or the role „bearbeiten“ do not get removed members in
 * the view, so that one is named from the row.
 */
export function zustaendigWahl(
  mitglieder: Pick<PlanungMitglied, 'id' | 'name' | 'entzogen'>[],
  zeile: Pick<PackZeile, 'zustaendigId' | 'zustaendig'>
): { id: number; name: string }[] {
  const wahl = mitglieder
    .filter((m) => !m.entzogen || m.id === zeile.zustaendigId)
    .map(({ id, name }) => ({ id, name }));
  if (zeile.zustaendigId !== null && !wahl.some((m) => m.id === zeile.zustaendigId))
    wahl.push({ id: zeile.zustaendigId, name: zeile.zustaendig || 'Mitglied ohne Zugang' });
  return wahl;
}

/** A free name as it is saved: trimmed, inner whitespace collapsed. */
export function freiName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * A free name typed at a row. It keeps the version of the row it was typed on, so saving it over
 * a change of someone else is a conflict; `gesendet` is the text of a save still running.
 */
export interface PackEntwurf {
  text: string;
  /** The version of the row when the field was opened; null while nothing is stored. */
  etag: string | null;
  gesendet: string | null;
  /** Someone else changed the row meanwhile; only Enter saves over it now. */
  konflikt: boolean;
}

/**
 * Whether a free name typed at a row differs from what is saved there, also while it is saved or
 * after saving failed. `entwuerfe` are the open fields by row key.
 */
export function entwurfOffen(
  entwuerfe: Record<string, Pick<PackEntwurf, 'text'>>,
  zeilen: PackZeile[]
): boolean {
  return zeilen.some((zeile) => {
    const entwurf = entwuerfe[zeile.key];
    if (entwurf === undefined) return false;
    return freiName(entwurf.text) !== (zeile.zustaendigId === null ? zeile.zustaendig : '');
  });
}

/**
 * The draft after its save `gesendet` went through: gone when it still is that text; typed on
 * meanwhile (e.g. in the row shown anew after a filter), it stays on the version now saved.
 */
export function entwurfNachSpeichern(
  entwurf: PackEntwurf | undefined,
  gesendet: string,
  etagJetzt: string | null
): PackEntwurf | null {
  if (!entwurf || freiName(entwurf.text) === gesendet) return null;
  return { ...entwurf, etag: etagJetzt, gesendet: null, konflikt: false };
}
