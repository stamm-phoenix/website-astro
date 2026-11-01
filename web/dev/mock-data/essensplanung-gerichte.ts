/**
 * Dishes and the ingredients of a Planung in the mock API, with the same rules as
 * `api/lib/essen-gerichte.ts`.
 */
import type { EssenEinheitenart } from '../../../api/lib/essen-validation';
import type {
  Gericht,
  GerichtEinheit,
  GerichtZutat,
  PlanungZutat,
} from '../../../api/lib/essen-gerichte-model';
import type { PlanungAnsicht } from '../../../api/lib/essen-planung-model';
import {
  MAX_GERICHTE,
  MAX_ZEILEN_PRO_GERICHT,
  einheitenartVon,
  gerichtStand,
} from '../../../api/lib/essen-gerichte-model';
import type {
  GerichtInput,
  GerichtZutatInput,
  PlanungZutatInput,
} from '../../../api/lib/essen-gerichte-validation';
import { validatePlanungZutat } from '../../../api/lib/essen-gerichte-validation';
import { createEssenEintrag, essenKatalog } from './essensplanung';
import type { MockPlanung, MockZugang } from './essensplanung-planung';
import { MockPlanungFehler, aendere, neueId, neuesEtag } from './essensplanung-planung';

export interface MockPlanungZutat {
  id: number;
  etag: string;
  zutatId: number | null;
  name: string | null;
  kategorieId: number | null;
  einheitenart: EssenEinheitenart | null;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  allergene: number[];
  geschaeftId: number | null;
  /** Only own ones; false for what came onto the shopping list by name. */
  lebensmittel?: boolean;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function feld(field: string, message: string): MockPlanungFehler {
  return new MockPlanungFehler(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
    [field]: message,
  });
}

const konflikt = () =>
  new MockPlanungFehler(409, 'CONFLICT', 'Jemand anderes hat das gerade geändert.');
const nichtGefunden = () =>
  new MockPlanungFehler(404, 'NOT_FOUND', 'Das gibt es inzwischen nicht mehr.');

/**
 * The lines of dishes, stock, extra needs, what cooked dishes used and the shopping trips that use
 * an ingredient, with their unit.
 */
function nutzungen(planung: MockPlanung, id: number): { einheit: GerichtZutat['einheit'] }[] {
  return [
    ...planung.gerichte.flatMap((g) => g.zutaten),
    ...planung.bestand,
    ...planung.zusatzbedarf,
    ...planung.tage
      .flatMap((t) => t.mahlzeiten.flatMap((m) => m.einplanungen))
      .flatMap((e) => e.verbrauch),
    ...planung.einkaeufe.flatMap((e) => [...e.posten, ...e.regeln]),
  ].filter((nutzung) => nutzung.planungZutatId === id);
}

function wirksam(planung: MockPlanung, zutat: MockPlanungZutat): PlanungZutat {
  const zentral = zutat.zutatId
    ? essenKatalog().zutaten.find((z) => z.id === zutat.zutatId)
    : undefined;
  return {
    id: zutat.id,
    etag: zutat.etag,
    zutatId: zutat.zutatId,
    name: zentral?.name ?? zutat.name ?? '',
    kategorieId: zutat.kategorieId ?? zentral?.kategorieId ?? 0,
    einheitenart: zutat.einheitenart ?? zentral?.einheitenart ?? 'masse',
    abtropfgewicht: zentral?.abtropfgewicht ?? false,
    lebensmittel: zentral?.lebensmittel ?? zutat.lebensmittel ?? true,
    vegetarisch: zentral ? zentral.vegetarisch : zutat.vegetarisch,
    vegan: zentral ? zentral.vegan : zutat.vegan,
    allergene: zentral ? [...zentral.allergene] : [...zutat.allergene],
    abweichend: {
      kategorie: Boolean(zentral) && zutat.kategorieId !== null,
      einheitenart: Boolean(zentral) && zutat.einheitenart !== null,
    },
    zeilen: nutzungen(planung, zutat.id).length,
    geschaeftId: zutat.geschaeftId,
  };
}

/** The ingredients and dishes in the view of a Planung. */
export function gerichteAnsicht(
  planung: MockPlanung
): Pick<PlanungAnsicht, 'zutaten' | 'gerichte'> {
  return {
    zutaten: planung.zutaten
      .map((zutat) => wirksam(planung, zutat))
      .sort((a, b) => collator.compare(a.name, b.name)),
    gerichte: structuredClone(planung.gerichte).sort((a, b) => collator.compare(a.name, b.name)),
  };
}

function zutatVon(z: MockZugang, id: number): MockPlanungZutat {
  const zutat = z.planung.zutaten.find((entry) => entry.id === id);
  if (!zutat) throw nichtGefunden();
  return zutat;
}

export function eigeneZutatAnlegen(z: MockZugang, input: PlanungZutatInput): number {
  if (essenKatalog().zutaten.some((zutat) => collator.compare(zutat.name, input.name!) === 0))
    throw feld(
      'name',
      'Diese Zutat gibt es schon. Wähle sie in der Liste aus, statt sie neu anzulegen.'
    );
  if (
    z.planung.zutaten.some((zutat) => zutat.name && collator.compare(zutat.name, input.name!) === 0)
  )
    throw feld(
      'name',
      'Diese Zutat gibt es schon. Wähle sie in der Liste aus, statt sie neu anzulegen.'
    );
  const id = neueId();
  aendere(z, 'zutat-neu', { name: input.name }, () => {
    z.planung.zutaten.push({
      id,
      etag: neuesEtag(),
      zutatId: null,
      name: input.name!,
      kategorieId: input.kategorieId,
      einheitenart: input.einheitenart,
      vegetarisch: input.vegetarisch ?? null,
      vegan: input.vegan ?? null,
      allergene: input.allergene ?? [],
      geschaeftId: null,
    });
  });
  return id;
}

export function planungZutatAendern(z: MockZugang, id: number, body: unknown, ifMatch: unknown) {
  const zutat = zutatVon(z, id);
  if (zutat.etag !== ifMatch) throw konflikt();
  const input = validatePlanungZutat(body, { eigene: zutat.zutatId === null });
  const zentral = zutat.zutatId
    ? essenKatalog().zutaten.find((entry) => entry.id === zutat.zutatId)
    : undefined;
  aendere(z, 'zutat-geaendert', { name: input.name ?? zentral?.name }, () => {
    Object.assign(
      zutat,
      zutat.zutatId === null
        ? {
            name: input.name,
            kategorieId: input.kategorieId,
            einheitenart: input.einheitenart,
            vegetarisch: input.vegetarisch ?? null,
            vegan: input.vegan ?? null,
            allergene: input.allergene ?? [],
          }
        : { kategorieId: input.kategorieId, einheitenart: input.einheitenart },
      { etag: neuesEtag() }
    );
  });
}

export function planungZutatLoeschen(z: MockZugang, id: number, ifMatch: unknown) {
  const zutat = zutatVon(z, id);
  if (zutat.etag !== ifMatch) throw konflikt();
  if (nutzungen(z.planung, id).length)
    throw feld(
      'name',
      'Gerichte, Bestand, Zusatzbedarf oder Einkäufe nutzen diese Zutat noch. Entferne sie zuerst dort.'
    );
  aendere(z, 'zutat-geloescht', { name: wirksam(z.planung, zutat).name }, () => {
    z.planung.zutaten.splice(z.planung.zutaten.indexOf(zutat), 1);
  });
}

/** Like `zutatDerPlanungFuer`: dishes take only food, stock and extra needs anything. */
export function zutatFuer(
  z: MockZugang,
  zutat: GerichtZutatInput['zutat'],
  { lebensmittel }: { lebensmittel: boolean }
): PlanungZutat {
  if ('planungZutatId' in zutat) {
    const vorhanden = z.planung.zutaten.find((entry) => entry.id === zutat.planungZutatId);
    if (!vorhanden) throw feld('zutat', 'Bitte eine Zutat wählen.');
    const wirksame = wirksam(z.planung, vorhanden);
    if (lebensmittel && !wirksame.lebensmittel)
      throw feld('zutat', `${wirksame.name} ist kein Lebensmittel und gehört in kein Gericht.`);
    return wirksame;
  }
  const zentral = essenKatalog().zutaten.find((entry) => entry.id === zutat.zutatId);
  if (!zentral) throw feld('zutat', 'Bitte eine Zutat wählen.');
  if (lebensmittel && !zentral.lebensmittel)
    throw feld('zutat', `${zentral.name} ist kein Lebensmittel und gehört in kein Gericht.`);
  let eintrag = z.planung.zutaten.find((entry) => entry.zutatId === zentral.id);
  if (!eintrag) {
    eintrag = {
      id: neueId(),
      etag: neuesEtag(),
      zutatId: zentral.id,
      name: null,
      kategorieId: null,
      einheitenart: null,
      vegetarisch: null,
      vegan: null,
      allergene: [],
      geschaeftId: null,
    };
    z.planung.zutaten.push(eintrag);
  }
  return wirksam(z.planung, eintrag);
}

/** „Sonstiges“, added again when the Steuerung renamed or deleted it, like the API. */
function sonstigesKategorie(): number {
  const vorhanden = essenKatalog().kategorien.find((k) => k.name === 'Sonstiges');
  if (vorhanden) return vorhanden.id;
  const neu = createEssenEintrag('kategorien', 'Sonstiges');
  return typeof neu === 'object' && 'ok' in neu && neu.id !== undefined ? neu.id : 1;
}

/** Like `sonstigesDerPlanung`: a typed name on the shopping list. */
export function sonstigesFuer(
  z: MockZugang,
  name: string,
  einheit: GerichtEinheit | null
): PlanungZutat {
  const zentral = essenKatalog().zutaten.find((entry) => collator.compare(entry.name, name) === 0);
  if (zentral) return zutatFuer(z, { zutatId: zentral.id }, { lebensmittel: false });
  const eigene = z.planung.zutaten.find(
    (entry) => entry.name && collator.compare(entry.name, name) === 0
  );
  if (eigene) return wirksam(z.planung, eigene);
  const einheitenart = einheit === null ? 'stueck' : (einheitenartVon(einheit) ?? 'stueck');
  const eintrag: MockPlanungZutat = {
    id: neueId(),
    etag: neuesEtag(),
    zutatId: null,
    name,
    kategorieId: sonstigesKategorie(),
    einheitenart,
    vegetarisch: null,
    vegan: null,
    allergene: [],
    geschaeftId: null,
    lebensmittel: false,
  };
  z.planung.zutaten.push(eintrag);
  return wirksam(z.planung, eintrag);
}

function gerichtVon(z: MockZugang, id: number): Gericht {
  const gericht = z.planung.gerichte.find((entry) => entry.id === id);
  if (!gericht) throw nichtGefunden();
  return gericht;
}

const GIBT_ES = 'Ein Gericht mit diesem Namen gibt es in dieser Planung schon.';

export function gerichtAnlegen(z: MockZugang, input: GerichtInput): number {
  if (z.planung.gerichte.length >= MAX_GERICHTE)
    throw feld('name', `Eine Planung hat höchstens ${MAX_GERICHTE} Gerichte.`);
  if (z.planung.gerichte.some((g) => collator.compare(g.name, input.name!) === 0))
    throw feld('name', GIBT_ES);
  const id = neueId();
  aendere(z, 'gericht-neu', { name: input.name }, () => {
    z.planung.gerichte.push({
      id,
      etag: neuesEtag(),
      name: input.name!,
      personen: input.personen!,
      anleitung: input.anleitung ?? '',
      notiz: input.notiz ?? '',
      links: input.links ?? [],
      werkzeuge: input.werkzeuge ?? [],
      zutaten: [],
    });
  });
  return id;
}

export function gerichtAendern(
  z: MockZugang,
  id: number,
  input: GerichtInput | null,
  ifMatch: unknown
): void {
  const gericht = gerichtVon(z, id);
  const mahlzeiten = z.planung.tage.flatMap((tag) => tag.mahlzeiten);
  const plaetze = mahlzeiten.flatMap((m) => m.einplanungen.filter((e) => e.gerichtId === id));
  const stand = input
    ? gericht.etag
    : gerichtStand(
        gericht,
        plaetze.map((e) => e.etag)
      );
  if (stand !== ifMatch) throw konflikt();
  if (!input) {
    aendere(z, 'gericht-geloescht', { name: gericht.name }, () => {
      z.planung.gerichte.splice(z.planung.gerichte.indexOf(gericht), 1);
      // Its places in the plan go with it
      for (const mahlzeit of mahlzeiten) {
        mahlzeit.einplanungen = mahlzeit.einplanungen
          .filter((e) => e.gerichtId !== id)
          .map((e, index) => ({ ...e, position: index + 1 }));
      }
    });
    return;
  }
  if (
    input.name !== undefined &&
    z.planung.gerichte.some((g) => g !== gericht && collator.compare(g.name, input.name!) === 0)
  )
    throw feld('name', GIBT_ES);
  aendere(z, 'gericht-geaendert', { name: input.name ?? gericht.name }, () => {
    Object.assign(gericht, input, { etag: neuesEtag() });
  });
}

function zeileVon(z: MockZugang, id: number): { gericht: Gericht; zeile: GerichtZutat } {
  for (const gericht of z.planung.gerichte) {
    const zeile = gericht.zutaten.find((entry) => entry.id === id);
    if (zeile) return { gericht, zeile };
  }
  throw nichtGefunden();
}

function nummeriere(gericht: Gericht, zeile?: GerichtZutat, position?: number): void {
  const liste = gericht.zutaten
    .filter((entry) => entry !== zeile)
    .sort((a, b) => a.position - b.position);
  if (zeile)
    liste.splice(Math.min(Math.max((position ?? liste.length + 1) - 1, 0), liste.length), 0, zeile);
  liste.forEach((entry, index) => (entry.position = index + 1));
  gericht.zutaten = liste;
}

function zeileAus(input: GerichtZutatInput, zutat: PlanungZutat) {
  return {
    planungZutatId: zutat.id,
    menge: input.menge,
    einheit: input.einheit,
    fest: input.fest,
    fuerAlles: input.fuerAlles,
    fuerVegetarisch: input.fuerVegetarisch,
    fuerVegan: input.fuerVegan,
    ohne: input.ohne,
    nur: input.nur,
    hinweis: input.hinweis,
  };
}

export function gerichtZutatAnlegen(
  z: MockZugang,
  gerichtId: number,
  input: GerichtZutatInput,
  position?: number
): void {
  const gericht = gerichtVon(z, gerichtId);
  if (gericht.zutaten.length >= MAX_ZEILEN_PRO_GERICHT)
    throw feld('zutat', `Ein Gericht hat höchstens ${MAX_ZEILEN_PRO_GERICHT} Zutaten.`);
  const zutat = zutatFuer(z, input.zutat, { lebensmittel: true });
  const werte = zeileAus(input, zutat);
  aendere(z, 'gericht-zutat-neu', { name: zutat.name, gericht: gericht.name }, () => {
    const zeile: GerichtZutat = {
      id: neueId(),
      etag: neuesEtag(),
      position: gericht.zutaten.length + 1,
      ...werte,
    };
    gericht.zutaten.push(zeile);
    if (position !== undefined) nummeriere(gericht, zeile, position);
  });
}

export function gerichtZutatAendern(
  z: MockZugang,
  id: number,
  input: (GerichtZutatInput & { position?: number }) | null,
  ifMatch: unknown
): void {
  const { gericht, zeile } = zeileVon(z, id);
  if (zeile.etag !== ifMatch) throw konflikt();
  if (!input) {
    const name = wirksam(
      z.planung,
      z.planung.zutaten.find((entry) => entry.id === zeile.planungZutatId)!
    ).name;
    aendere(z, 'gericht-zutat-geloescht', { name, gericht: gericht.name }, () => {
      gericht.zutaten = gericht.zutaten.filter((entry) => entry !== zeile);
      nummeriere(gericht);
    });
    return;
  }
  const zutat = zutatFuer(z, input.zutat, { lebensmittel: true });
  const werte = zeileAus(input, zutat);
  aendere(z, 'gericht-zutat-geaendert', { name: zutat.name, gericht: gericht.name }, () => {
    Object.assign(zeile, werte, { etag: neuesEtag() });
    if (input.position !== undefined) nummeriere(gericht, zeile, input.position);
  });
}
