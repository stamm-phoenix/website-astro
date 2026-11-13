import { packlisteSchluessel } from '../../../api/lib/essen-packliste-model';
import { einplanungKennung } from './essensplanungEinplanung';
import type { PackZuteilung, PacklisteEintrag } from '../../../api/lib/essen-packliste-model';
import type { PlanungAnsicht, PlanungMitglied } from '../../../api/lib/essen-planung-model';

/**
 * The packing list of a Planung (`docs/essensplanung.md`, Packliste): the tools of all planned
 * dishes, merged by name (`packlisteSchluessel`), with the dishes and planned meals that need
 * them, and the entries of its own. What someone set at a tool comes from its stored row: whether
 * it is packed and the persons who pack it, each with their own box.
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
  /** The whole thing: its one box, or with persons whether all of them packed. */
  gepackt: boolean;
  /** Who packs it, each with their own box; empty for nobody. */
  personen: PackZuteilung[];
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
    personen: eintrag?.zuteilungen ?? [],
  });
  // An entry of its own named like a tool of a dish planned later is that tool: one row, with
  // the state of the entry and the dishes of the tool; it stays removable as an entry
  const eigene = new Map(
    ansicht.packliste
      .filter((eintrag) => eintrag.werkzeug === null)
      .map((eintrag) => [packlisteSchluessel(eintrag.name), eintrag])
  );
  const zeilen: PackZeile[] = [
    ...[...werkzeuge].map(([key, werkzeug]): PackZeile => {
      const eigen = eigene.get(key);
      eigene.delete(key);
      return eigen
        ? {
            key: `e:${eigen.id}`,
            werkzeug: null,
            name: eigen.name,
            ...zustand(eigen),
            gerichte: [...werkzeug.gerichte.values()],
          }
        : {
            key: `w:${key}`,
            werkzeug: key,
            name: werkzeug.name,
            ...zustand(gespeichert.get(key) ?? null),
            gerichte: [...werkzeug.gerichte.values()],
          };
    }),
    ...[...eigene.values()].map((eintrag) => ({
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
    return zeilen.filter(
      (zeile) => ichId !== null && zeile.personen.some((p) => p.mitgliedId === ichId)
    );
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
    zustaendig: personenText(zeile, true),
  }));
}

/**
 * „Kim Küche, Alex Rover“; with `stand` and several persons, who packed is named, as one box
 * stands for all: „Kim Küche (gepackt), Alex Rover“.
 */
export function personenText(zeile: Pick<PackZeile, 'personen'>, stand = false): string {
  const mehrere = zeile.personen.length > 1;
  return zeile.personen
    .map((p) => (stand && mehrere && p.gepackt ? `${p.name} (gepackt)` : p.name))
    .join(', ');
}

/**
 * The id of a row's elements: the UTF-16 code units of the key in hex. Never throws, also for a
 * lone surrogate a name may have from elsewhere, and loses nothing, so „Grill-Zange“ and
 * „Grill Zange“, two rows of the list, never share a box and its label.
 */
export function packId(key: string): string {
  let hex = '';
  for (let index = 0; index < key.length; index++)
    hex += key.charCodeAt(index).toString(16).padStart(4, '0');
  return `pack-${hex}`;
}

/** The key of a person, like the column of the matrix: `m:<id>` or `t:<merged name>`. */
export function personKey(person: Pick<PackZuteilung, 'mitgliedId' | 'name'>): string {
  return person.mitgliedId !== null
    ? `m:${person.mitgliedId}`
    : `t:${packlisteSchluessel(person.name)}`;
}

/** The members to choose who packs a thing: those with access, and those it has even without. */
export function personenWahl(
  mitglieder: Pick<PlanungMitglied, 'id' | 'name' | 'entzogen' | 'ich'>[],
  zeile: Pick<PackZeile, 'personen'> | null
): { id: number; name: string; ich: boolean; ohneZugang: boolean }[] {
  const hat = (id: number) => zeile?.personen.some((p) => p.mitgliedId === id) ?? false;
  const wahl = mitglieder
    .filter((m) => !m.entzogen || hat(m.id))
    .map(({ id, name, ich, entzogen }) => ({ id, name, ich, ohneZugang: entzogen }));
  // Members the view lacks, e.g. one without access for those who do not manage the members
  for (const person of zeile?.personen ?? []) {
    if (person.mitgliedId !== null && !wahl.some((m) => m.id === person.mitgliedId))
      wahl.push({
        id: person.mitgliedId,
        name: person.name || 'Mitglied ohne Zugang',
        ich: false,
        ohneZugang: true,
      });
  }
  return wahl;
}

/** Who is chosen to pack a thing: members and free names. */
export interface PackAuswahl {
  mitglieder: number[];
  namen: string[];
}

/** The choice a row starts with: its persons. */
export function auswahlVon(zeile: Pick<PackZeile, 'personen'>): PackAuswahl {
  return {
    mitglieder: zeile.personen.flatMap((p) => (p.mitgliedId !== null ? [p.mitgliedId] : [])),
    namen: zeile.personen.flatMap((p) => (p.mitgliedId === null ? [p.name] : [])),
  };
}

/**
 * What saves a choice at a row: the persons to add and the assignments to take off. Nothing
 * else, so a person someone else added meanwhile stays.
 */
export function personenAenderung(
  zeile: Pick<PackZeile, 'personen'>,
  auswahl: PackAuswahl
): { mitglieder: number[]; namen: string[]; weg: number[] } {
  const namen = new Set(auswahl.namen.map(packlisteSchluessel));
  const da = new Set(zeile.personen.map(personKey));
  return {
    mitglieder: auswahl.mitglieder.filter((id) => !da.has(`m:${id}`)),
    namen: auswahl.namen.filter((name) => !da.has(`t:${packlisteSchluessel(name)}`)),
    weg: zeile.personen
      .filter((p) =>
        p.mitgliedId !== null
          ? !auswahl.mitglieder.includes(p.mitgliedId)
          : !namen.has(packlisteSchluessel(p.name))
      )
      .map((p) => p.id),
  };
}

/** A free name as it is saved: trimmed, inner whitespace collapsed. */
export function freiName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
