/**
 * Groups and participants of the Planungen in the mock API, like `api/lib/essen-teilnehmende.ts`.
 */
import type {
  Ernaehrung,
  GruppeInput,
  PlanungGruppe,
  Teilnehmende,
  TeilnehmendeInput,
} from '../../../api/lib/essen-teilnehmende-model';
import { MAX_GRUPPEN, MAX_TEILNEHMENDE } from '../../../api/lib/essen-teilnehmende-model';
import { essenKatalog } from './essensplanung';
import type { MockPlanung, MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neueId, neuesEtag, nichtGefunden } from './essensplanung-planung';

/** The meals in their order, like the database: days by date, meals by position. */
function reihe(planung: MockPlanung): number[] {
  return planung.tage
    .slice()
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .flatMap((tag) => tag.mahlzeiten.slice().sort((a, b) => a.position - b.position || a.id - b.id))
    .map((m) => m.id);
}

const ERNAEHRUNG_REIHE: Record<Ernaehrung, number> = { alles: 0, vegetarisch: 1, vegan: 2 };

/** Like `ladeTeilnehmende`: by the position of the group, then the diet. */
export function sortiereTeilnehmende(planung: MockPlanung): Teilnehmende[] {
  const position = new Map(planung.gruppen.map((g) => [g.id, g.position]));
  return planung.teilnehmende
    .slice()
    .sort(
      (a, b) =>
        (position.get(a.gruppeId) ?? 0) - (position.get(b.gruppeId) ?? 0) ||
        ERNAEHRUNG_REIHE[a.ernaehrung] - ERNAEHRUNG_REIHE[b.ernaehrung] ||
        a.id - b.id
    );
}

/** The groups of a new Planung, from the template of the Steuerung. */
export function gruppenAusVorlage(vorlage: { name: string; faktor: number }[]): PlanungGruppe[] {
  return vorlage.map((gruppe, index) => ({
    id: neueId(),
    etag: neuesEtag(),
    position: index + 1,
    name: gruppe.name,
    faktor: gruppe.faktor,
  }));
}

function gruppeVon(z: MockZugang, id: number): PlanungGruppe {
  const gruppe = z.planung.gruppen.find((g) => g.id === id);
  if (!gruppe) throw nichtGefunden();
  return gruppe;
}

const gleich = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' }) === 0;

export function gruppeAnlegen(z: MockZugang, input: GruppeInput): void {
  if (z.planung.gruppen.length >= MAX_GRUPPEN)
    throw feld('name', `Höchstens ${MAX_GRUPPEN} Gruppen.`);
  if (z.planung.gruppen.some((g) => gleich(g.name, input.name)))
    throw feld('name', 'Diese Gruppe gibt es schon.');
  aendere(z, 'gruppe-neu', { name: input.name }, () => {
    z.planung.gruppen.push({
      id: neueId(),
      etag: neuesEtag(),
      position: Math.max(0, ...z.planung.gruppen.map((g) => g.position)) + 1,
      ...input,
    });
  });
}

/** Changes (`input`) or deletes (null) a group. */
export function gruppeAendern(
  z: MockZugang,
  id: number,
  input: GruppeInput | null,
  ifMatch: unknown
): void {
  const gruppe = gruppeVon(z, id);
  if (!input) {
    if (z.planung.teilnehmende.some((t) => t.gruppeId === id))
      throw feld('name', 'Die Gruppe hat noch Teilnehmende. Entferne oder verschiebe sie zuerst.');
    if (gruppe.etag !== ifMatch) throw konflikt();
    aendere(z, 'gruppe-geloescht', { name: gruppe.name }, () => {
      z.planung.gruppen.splice(z.planung.gruppen.indexOf(gruppe), 1);
      for (const mahlzeit of z.planung.tage.flatMap((tag) => tag.mahlzeiten))
        mahlzeit.ohneGruppen = mahlzeit.ohneGruppen.filter((g) => g !== id);
    });
    return;
  }
  if (z.planung.gruppen.some((g) => g !== gruppe && gleich(g.name, input.name)))
    throw feld('name', 'Diese Gruppe gibt es schon.');
  if (gruppe.etag !== ifMatch) throw konflikt();
  const details = {
    name: input.name,
    ...(gruppe.name !== input.name ? { vorher: gruppe.name } : {}),
  };
  aendere(z, 'gruppe-geaendert', details, () => {
    Object.assign(gruppe, input, { etag: neuesEtag() });
  });
}

function pruefe(z: MockZugang, input: TeilnehmendeInput, bisher?: Teilnehmende): void {
  if (!z.planung.gruppen.some((g) => g.id === input.gruppeId))
    throw feld('gruppeId', 'Bitte eine Gruppe wählen.');
  const ids = reihe(z.planung);
  const index = (id: number | null) => (id === null ? null : ids.indexOf(id));
  const von = index(input.vonMahlzeitId);
  const bis = index(input.bisMahlzeitId);
  if (von === -1 && input.vonMahlzeitId !== bisher?.vonMahlzeitId)
    throw feld('vonMahlzeitId', 'Diese Mahlzeit gibt es nicht mehr.');
  if (bis === -1 && input.bisMahlzeitId !== bisher?.bisMahlzeitId)
    throw feld('bisMahlzeitId', 'Diese Mahlzeit gibt es nicht mehr.');
  if (von !== null && bis !== null && von >= 0 && bis >= 0 && von > bis)
    throw feld('bisMahlzeitId', 'Bis liegt vor Von.');
  const bekannt = new Set(essenKatalog().unvertraeglichkeiten.map((u) => u.id));
  if (input.unvertraeglichkeiten.some((id) => !bekannt.has(id)))
    throw feld('unvertraeglichkeiten', 'Bitte aus der Liste wählen.');
}

export function teilnehmendeAnlegen(z: MockZugang, input: TeilnehmendeInput): void {
  pruefe(z, input);
  if (z.planung.teilnehmende.length >= MAX_TEILNEHMENDE)
    throw feld('anzahl', `Höchstens ${MAX_TEILNEHMENDE} Zeilen.`);
  const name = gruppeVon(z, input.gruppeId).name;
  aendere(z, 'teilnehmende-neu', { name, anzahl: input.anzahl }, () => {
    z.planung.teilnehmende.push({ id: neueId(), etag: neuesEtag(), ...input });
  });
}

/** Changes (`input`) or deletes (null) a row of participants. */
export function teilnehmendeAendern(
  z: MockZugang,
  id: number,
  input: TeilnehmendeInput | null,
  ifMatch: unknown
): void {
  const zeile = z.planung.teilnehmende.find((t) => t.id === id);
  if (!zeile) throw nichtGefunden();
  if (!input) {
    if (zeile.etag !== ifMatch) throw konflikt();
    const name = gruppeVon(z, zeile.gruppeId).name;
    aendere(z, 'teilnehmende-geloescht', { name, anzahl: zeile.anzahl }, () => {
      z.planung.teilnehmende.splice(z.planung.teilnehmende.indexOf(zeile), 1);
    });
    return;
  }
  pruefe(z, input, zeile);
  if (zeile.etag !== ifMatch) throw konflikt();
  const name = gruppeVon(z, input.gruppeId).name;
  aendere(z, 'teilnehmende-geaendert', { name, anzahl: input.anzahl }, () => {
    Object.assign(zeile, input, { etag: neuesEtag() });
  });
}

export function mahlzeitGruppe(
  z: MockZugang,
  mahlzeitId: number,
  gruppeId: number,
  isst: boolean
): void {
  const tag = z.planung.tage.find((t) => t.mahlzeiten.some((m) => m.id === mahlzeitId));
  const mahlzeit = tag?.mahlzeiten.find((m) => m.id === mahlzeitId);
  if (!tag || !mahlzeit) throw nichtGefunden();
  const gruppe = gruppeVon(z, gruppeId);
  const details = { name: mahlzeit.name, datum: tag.datum, gruppe: gruppe.name, isst };
  aendere(z, 'mahlzeit-gruppen', details, () => {
    if (isst !== mahlzeit.ohneGruppen.includes(gruppeId)) return;
    mahlzeit.ohneGruppen = mahlzeit.ohneGruppen.filter((g) => g !== gruppeId);
    if (!isst) mahlzeit.ohneGruppen.push(gruppeId);
    // A real change gives the meal a new version, like the API
    mahlzeit.etag = neuesEtag();
  });
}

/** Like `verschiebeGrenzen`: limits on meals that go move to the next remaining ones. */
export function verschiebeGrenzen(planung: MockPlanung, weg: number[]): void {
  const ids = reihe(planung);
  const bleibt = (id: number) => !weg.includes(id);
  for (const zeile of planung.teilnehmende) {
    let von = zeile.vonMahlzeitId;
    let bis = zeile.bisMahlzeitId;
    const vonWeg = von !== null && weg.includes(von);
    const bisWeg = bis !== null && weg.includes(bis);
    if (!vonWeg && !bisWeg) continue;
    if (von !== null && vonWeg) {
      von = ids.slice(ids.indexOf(von) + 1).find(bleibt) ?? von;
    }
    if (bis !== null && bisWeg) {
      bis = ids.slice(0, ids.indexOf(bis)).reverse().find(bleibt) ?? bis;
    }
    // The whole stay went: keep the gone limits, like the API
    if (von !== null && bis !== null && ids.indexOf(von) > ids.indexOf(bis)) {
      von = zeile.vonMahlzeitId;
      bis = zeile.bisMahlzeitId;
    }
    Object.assign(zeile, { vonMahlzeitId: von, bisMahlzeitId: bis, etag: neuesEtag() });
  }
}
