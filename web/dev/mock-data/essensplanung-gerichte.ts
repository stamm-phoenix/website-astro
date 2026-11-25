/**
 * Dishes of a Planung in the mock API, with the same rules as `api/lib/essen-gerichte.ts`; their
 * ingredients are in `essensplanung-zutaten.ts`.
 */
import type { Gericht, GerichtZutat, PlanungZutat } from '../../../api/lib/essen-gerichte-model';
import type { PlanungAnsicht } from '../../../api/lib/essen-planung-model';
import {
  MAX_GERICHTE,
  MAX_ZEILEN_PRO_GERICHT,
  gerichtStand,
} from '../../../api/lib/essen-gerichte-model';
import type { GerichtInput, GerichtZutatInput } from '../../../api/lib/essen-gerichte-validation';
import type { MockPlanung, MockZugang } from './essensplanung-planung';
import { aendere, neueId, neuesEtag } from './essensplanung-planung';
import {
  collator,
  feld,
  konflikt,
  nichtGefunden,
  wirksam,
  zutatFuer,
} from './essensplanung-zutaten';
import { einplanungVorbereiten } from './essensplanung-einplanung';
import type { EinplanungInput } from '../../../api/lib/essen-planung-model';

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

function gerichtVon(z: MockZugang, id: number): Gericht {
  const gericht = z.planung.gerichte.find((entry) => entry.id === id);
  if (!gericht) throw nichtGefunden();
  return gericht;
}

const GIBT_ES = 'Ein Gericht mit diesem Namen gibt es in dieser Planung schon.';

/** Adds a dish, with `einplanung` planned at that meal in the same change, like the API. */
export function gerichtAnlegen(
  z: MockZugang,
  input: GerichtInput,
  einplanung?: Omit<EinplanungInput, 'gerichtId'>
): number {
  if (z.planung.gerichte.length >= MAX_GERICHTE)
    throw feld('name', `Eine Planung hat höchstens ${MAX_GERICHTE} Gerichte.`);
  if (z.planung.gerichte.some((g) => collator.compare(g.name, input.name!) === 0))
    throw feld('name', GIBT_ES);
  const platz = einplanung ? einplanungVorbereiten(z, einplanung) : undefined;
  const id = neueId();
  aendere(z, 'gericht-neu', { name: input.name, ...platz?.details }, () => {
    z.planung.gerichte.push({
      id,
      etag: neuesEtag(),
      name: input.name!,
      personen: input.personen ?? null,
      anleitung: input.anleitung ?? '',
      notiz: input.notiz ?? '',
      links: input.links ?? [],
      werkzeuge: input.werkzeuge ?? [],
      zutaten: [],
    });
    platz?.einfuegen(id);
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
  const zutat = zutatFuer(z, input.zutat, { lebensmittel: true, einheit: input.einheit });
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
  const zutat = zutatFuer(z, input.zutat, { lebensmittel: true, einheit: input.einheit });
  const werte = zeileAus(input, zutat);
  aendere(z, 'gericht-zutat-geaendert', { name: zutat.name, gericht: gericht.name }, () => {
    Object.assign(zeile, werte, { etag: neuesEtag() });
    if (input.position !== undefined) nummeriere(gericht, zeile, input.position);
  });
}
