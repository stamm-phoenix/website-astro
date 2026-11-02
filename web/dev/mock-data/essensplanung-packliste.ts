/**
 * The packing lists of the Planungen in the mock API, like `api/lib/essen-packliste.ts` and
 * `essen-packliste-zuteilung.ts`.
 */
import type {
  PackAenderung,
  PackEintragInput,
  PackPersonen,
  PacklisteEintrag,
  WerkzeugAenderung,
} from '../../../api/lib/essen-packliste-model';
import {
  MAX_PACK_PERSONEN,
  MAX_PACKLISTE,
  packlisteSchluessel,
} from '../../../api/lib/essen-packliste-model';
import type { MockPlanung, MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neueId, neuesEtag, nichtGefunden } from './essensplanung-planung';

/** A person who packs an entry; a member is shown by their current name. */
export interface MockZuteilung {
  id: number;
  etag: string;
  mitgliedId: number | null;
  /** The free name; empty for a member. */
  name: string;
  gepackt: boolean;
}

/** A stored entry with its persons. */
export interface MockPackEintrag {
  id: number;
  etag: string;
  werkzeug: string | null;
  name: string;
  gepackt: boolean;
  zuteilungen: MockZuteilung[];
}

/** The entries as the view shows them, with the members' current names. */
export function packlisteAnsicht(planung: MockPlanung): PacklisteEintrag[] {
  return planung.packliste.map((eintrag) => ({
    ...eintrag,
    zuteilungen: eintrag.zuteilungen.map((z) => ({ ...z, name: personName(planung, z) })),
  }));
}

function personName(planung: MockPlanung, z: MockZuteilung): string {
  return z.mitgliedId === null
    ? z.name
    : (planung.mitglieder.find((m) => m.id === z.mitgliedId)?.name ?? '');
}

/** The tools of the planned dishes by merged name, with the first name. */
function eingeplanteWerkzeuge(z: MockZugang): Map<string, string> {
  const geplant = new Set(
    z.planung.tage.flatMap((tag) =>
      tag.mahlzeiten.flatMap((m) => m.einplanungen.map((e) => e.gerichtId))
    )
  );
  const werkzeuge = new Map<string, string>();
  for (const gericht of [...z.planung.gerichte].sort((a, b) => a.id - b.id)) {
    if (!geplant.has(gericht.id)) continue;
    for (const name of gericht.werkzeuge) {
      const key = packlisteSchluessel(name);
      if (key && !werkzeuge.has(key)) werkzeuge.set(key, name.trim());
    }
  }
  return werkzeuge;
}

/** The entry is packed when all its persons packed; without persons it keeps its own box. */
function nachfuehren(eintrag: MockPackEintrag): void {
  if (!eintrag.zuteilungen.length) return;
  const alle = eintrag.zuteilungen.every((z) => z.gepackt);
  if (alle !== eintrag.gepackt) Object.assign(eintrag, { gepackt: alle, etag: neuesEtag() });
}

/**
 * Checks the persons to add and returns the change to apply, like `personenAendern` of the API:
 * new members need access, names there already count once.
 */
function personenPruefen(
  z: MockZugang,
  eintrag: Pick<MockPackEintrag, 'zuteilungen'>,
  hinzu: PackPersonen = { mitglieder: [], namen: [] },
  weg: number[] = []
) {
  const bleiben = eintrag.zuteilungen.filter((p) => !weg.includes(p.id));
  const mitglieder = hinzu.mitglieder.filter((id) => !bleiben.some((p) => p.mitgliedId === id));
  for (const id of mitglieder) {
    const mitglied = z.planung.mitglieder.find((m) => m.id === id);
    if (!mitglied || mitglied.entzogen) throw feld('mitglieder', 'Bitte aus der Liste wählen.');
  }
  const freie = new Set(
    bleiben.filter((p) => p.mitgliedId === null).map((p) => packlisteSchluessel(p.name))
  );
  const namen = hinzu.namen.filter((name) => !freie.has(packlisteSchluessel(name)));
  if (freie.size + namen.length > MAX_PACK_PERSONEN)
    throw feld('namen', `Höchstens ${MAX_PACK_PERSONEN} Namen.`);
  const entfernt = eintrag.zuteilungen.filter((p) => weg.includes(p.id));
  return {
    mitglieder,
    namen,
    entfernt,
    details: {
      ...(mitglieder.length || namen.length
        ? {
            hinzu: [
              ...mitglieder.map((id) => z.planung.mitglieder.find((m) => m.id === id)!.name),
              ...namen,
            ],
          }
        : {}),
      ...(entfernt.length ? { weg: entfernt.map((p) => personName(z.planung, p)) } : {}),
    },
  };
}

/** Applies checked persons (`personenPruefen`) to an entry. */
function personenAnwenden(
  eintrag: MockPackEintrag,
  personen: ReturnType<typeof personenPruefen>
): void {
  const start = eintrag.zuteilungen.length === 0 ? eintrag.gepackt : false;
  eintrag.zuteilungen = eintrag.zuteilungen.filter((p) => !personen.entfernt.includes(p));
  for (const [mitgliedId, name] of [
    ...personen.mitglieder.map((id) => [id, ''] as const),
    ...personen.namen.map((n) => [null, n] as const),
  ]) {
    eintrag.zuteilungen.push({
      id: neueId(),
      etag: neuesEtag(),
      mitgliedId,
      name,
      gepackt: start,
    });
  }
  if (personen.mitglieder.length || personen.namen.length || personen.entfernt.length)
    nachfuehren(eintrag);
}

/** Packs the whole entry on its version, then adds and takes off persons. */
function anwenden(
  z: MockZugang,
  eintrag: MockPackEintrag,
  aenderung: PackAenderung,
  etag: unknown
): { details: Record<string, unknown>; los: () => void } {
  if (aenderung.gepackt !== undefined && eintrag.etag !== etag) throw konflikt();
  const personen = personenPruefen(z, eintrag, aenderung.hinzu, aenderung.weg);
  return {
    details: {
      ...(aenderung.gepackt !== undefined ? { gepackt: aenderung.gepackt } : {}),
      ...personen.details,
    },
    los: () => {
      if (aenderung.gepackt !== undefined) {
        Object.assign(eintrag, { gepackt: aenderung.gepackt, etag: neuesEtag() });
        for (const p of eintrag.zuteilungen)
          if (p.gepackt !== aenderung.gepackt)
            Object.assign(p, { gepackt: aenderung.gepackt, etag: neuesEtag() });
      }
      personenAnwenden(eintrag, personen);
    },
  };
}

export function packEintragAnlegen(z: MockZugang, input: PackEintragInput): void {
  const eigene = z.planung.packliste.filter((e) => e.werkzeug === null);
  if (eigene.length >= MAX_PACKLISTE)
    throw feld('name', `Höchstens ${MAX_PACKLISTE} eigene Einträge.`);
  const key = packlisteSchluessel(input.name);
  if (eigene.some((e) => packlisteSchluessel(e.name) === key) || eingeplanteWerkzeuge(z).has(key))
    throw feld('name', 'Das steht schon auf der Packliste.');
  const eintrag: MockPackEintrag = {
    id: neueId(),
    etag: neuesEtag(),
    werkzeug: null,
    name: input.name,
    gepackt: false,
    zuteilungen: [],
  };
  const personen = personenPruefen(z, eintrag, input);
  aendere(z, 'packliste-neu', { name: input.name, ...personen.details }, () => {
    personenAnwenden(eintrag, personen);
    z.planung.packliste.push(eintrag);
  });
}

/** Changes (`aenderung`) or deletes (null) a stored entry. */
export function packEintragAendern(
  z: MockZugang,
  id: number,
  aenderung: PackAenderung | null,
  etag: unknown
): void {
  const eintrag = z.planung.packliste.find((e) => e.id === id);
  if (!eintrag) throw nichtGefunden();
  if (!aenderung) {
    if (eintrag.werkzeug !== null)
      throw feld(
        'name',
        'Werkzeuge der Gerichte bleiben auf der Liste, solange ein eingeplantes Gericht sie braucht.'
      );
    if (eintrag.etag !== etag) throw konflikt();
    aendere(z, 'packliste-geloescht', { name: eintrag.name }, () => {
      z.planung.packliste.splice(z.planung.packliste.indexOf(eintrag), 1);
    });
    return;
  }
  const { details, los } = anwenden(z, eintrag, aenderung, etag);
  aendere(z, 'packliste-geaendert', { name: eintrag.name, ...details }, los);
}

/** Packs or unpacks one person's share, on its version. */
export function zuteilungAbhaken(z: MockZugang, id: number, gepackt: boolean, etag: unknown): void {
  const eintrag = z.planung.packliste.find((e) => e.zuteilungen.some((p) => p.id === id));
  const person = eintrag?.zuteilungen.find((p) => p.id === id);
  if (!eintrag || !person) throw nichtGefunden();
  if (person.etag !== etag) throw konflikt();
  const details = { name: eintrag.name, gepackt, fuer: personName(z.planung, person) };
  aendere(z, 'packliste-geaendert', details, () => {
    Object.assign(person, { gepackt, etag: neuesEtag() });
    nachfuehren(eintrag);
  });
}

export function werkzeugSetzen(
  z: MockZugang,
  aenderung: WerkzeugAenderung,
  etag: string | null
): void {
  const key = packlisteSchluessel(aenderung.werkzeug);
  const name = eingeplanteWerkzeuge(z).get(key);
  if (!name) throw feld('werkzeug', 'Kein eingeplantes Gericht braucht dieses Werkzeug mehr.');
  // An entry of its own with this name is the row shown for the tool (see the API)
  if (z.planung.packliste.some((e) => e.werkzeug === null && packlisteSchluessel(e.name) === key))
    throw konflikt();
  const vorhanden = z.planung.packliste.find((e) => e.werkzeug === key);
  if (vorhanden) {
    const { details, los } = anwenden(z, vorhanden, aenderung, etag);
    aendere(z, 'packliste-geaendert', { name, ...details }, los);
    return;
  }
  // A version of a row that is not there: the page loads the current state
  if (etag !== null) throw konflikt();
  const eintrag: MockPackEintrag = {
    id: neueId(),
    etag: neuesEtag(),
    werkzeug: key,
    name,
    gepackt: aenderung.gepackt ?? false,
    zuteilungen: [],
  };
  const personen = personenPruefen(z, eintrag, aenderung.hinzu, aenderung.weg);
  const details = {
    ...(aenderung.gepackt !== undefined ? { gepackt: aenderung.gepackt } : {}),
    ...personen.details,
  };
  aendere(z, 'packliste-geaendert', { name, ...details }, () => {
    personenAnwenden(eintrag, personen);
    z.planung.packliste.push(eintrag);
  });
}
