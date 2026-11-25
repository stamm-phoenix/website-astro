/**
 * The ingredients of a Planung in the mock API, with the same rules as `api/lib/essen-gerichte.ts`
 * and `api/lib/essen-planung-zutat.ts`: the view of an ingredient, own ones, and what a line, the
 * stock or the shopping list picks, including a new name for a line.
 */
import type { EssenEinheitenart } from '../../../api/lib/essen-validation';
import type { ZutatAngabe } from '../../../api/lib/essen-zutat-angaben';
import type {
  GerichtEinheit,
  GerichtZutat,
  PlanungZutat,
} from '../../../api/lib/essen-gerichte-model';
import { einheitenartVon } from '../../../api/lib/essen-gerichte-model';
import type {
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
  /** Own ones added by name for a line: what the AI is still to fill in. */
  angabenOffen?: ZutatAngabe[];
  /** False while nobody saved the details of one added by name for a line. */
  angabenGeprueft?: boolean;
}

export const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

export function feld(field: string, message: string): MockPlanungFehler {
  return new MockPlanungFehler(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
    [field]: message,
  });
}

export const konflikt = () =>
  new MockPlanungFehler(409, 'CONFLICT', 'Jemand anderes hat das gerade geändert.');
export const nichtGefunden = () =>
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

export function wirksam(planung: MockPlanung, zutat: MockPlanungZutat): PlanungZutat {
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
    angaben: zentral
      ? 'geprueft'
      : zutat.angabenOffen?.length
        ? 'offen'
        : zutat.angabenGeprueft === false
          ? 'ki'
          : 'geprueft',
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
            angabenOffen: undefined,
            angabenGeprueft: true,
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
  { lebensmittel, einheit = null }: { lebensmittel: boolean; einheit?: GerichtEinheit | null }
): PlanungZutat {
  if ('neu' in zutat) return zutatNachName(z, zutat.neu, einheit, { lebensmittel });
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

/**
 * Like `sonstigesDerPlanung` (a typed name on the shopping list, no food) and
 * `neueZutatDerPlanung` (a new name for a line, food whose details the AI fills in).
 */
function zutatNachName(
  z: MockZugang,
  name: string,
  einheit: GerichtEinheit | null,
  { lebensmittel }: { lebensmittel: boolean }
): PlanungZutat {
  const zentral = essenKatalog().zutaten.find((entry) => collator.compare(entry.name, name) === 0);
  if (zentral) return zutatFuer(z, { zutatId: zentral.id }, { lebensmittel });
  const eigene = z.planung.zutaten.find(
    (entry) => entry.name && collator.compare(entry.name, name) === 0
  );
  if (eigene) return zutatFuer(z, { planungZutatId: eigene.id }, { lebensmittel });
  const bekannt = einheit === null ? null : einheitenartVon(einheit);
  const eintrag: MockPlanungZutat = {
    id: neueId(),
    etag: neuesEtag(),
    zutatId: null,
    name,
    kategorieId: sonstigesKategorie(),
    einheitenart: bekannt ?? 'stueck',
    vegetarisch: null,
    vegan: null,
    allergene: [],
    geschaeftId: null,
    lebensmittel,
    ...(lebensmittel
      ? {
          angabenOffen: bekannt
            ? ['kategorie', 'merkmale']
            : ['kategorie', 'einheitenart', 'merkmale'],
          angabenGeprueft: false,
        }
      : {}),
  };
  z.planung.zutaten.push(eintrag);
  return wirksam(z.planung, eintrag);
}

export const sonstigesFuer = (z: MockZugang, name: string, einheit: GerichtEinheit | null) =>
  zutatNachName(z, name, einheit, { lebensmittel: false });
