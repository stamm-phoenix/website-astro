/**
 * Shopping trips of the Planungen in the mock API, like `api/lib/essen-einkaeufe.ts`.
 */
import type {
  EinkaufInput,
  HakenInput,
  RegelInput,
  VerschiebenInput,
  ZurueckholenInput,
} from '../../../api/lib/essen-einkaeufe-model';
import {
  MAX_EINKAEUFE,
  MAX_EINKAUF_EINTRAEGE,
  einkaufStand,
} from '../../../api/lib/essen-einkaeufe-model';
import { EINHEITEN_JE_ART, einheitPasst } from '../../../api/lib/essen-gerichte-model';
import type { GerichtEinheit } from '../../../api/lib/essen-gerichte-model';
import { zutatFuer } from './essensplanung-gerichte';
import type { MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neueId, neuesEtag, nichtGefunden } from './essensplanung-planung';

function einkaufVon(z: MockZugang, id: number) {
  const einkauf = z.planung.einkaeufe.find((e) => e.id === id);
  if (!einkauf) throw nichtGefunden();
  return einkauf;
}

/** Like the API: a deleted meal sent back unchanged (`gespeichert`) covers all meals again. */
function pruefeBezug(
  z: MockZugang,
  input: EinkaufInput,
  gespeichert: number | null = null
): EinkaufInput {
  if (input.geschaeftId !== null && !z.planung.geschaefte.some((g) => g.id === input.geschaeftId))
    throw feld('geschaeftId', 'Dieses Geschäft gibt es nicht mehr.');
  if (
    input.bisMahlzeitId !== null &&
    !z.planung.tage.some((t) => t.mahlzeiten.some((m) => m.id === input.bisMahlzeitId))
  ) {
    if (input.bisMahlzeitId === gespeichert) return { ...input, bisMahlzeitId: null };
    throw feld('bisMahlzeitId', 'Diese Mahlzeit gibt es nicht mehr.');
  }
  return input;
}

export function einkaufAnlegen(z: MockZugang, input: EinkaufInput): void {
  if (z.planung.einkaeufe.length >= MAX_EINKAEUFE)
    throw feld('name', `Höchstens ${MAX_EINKAEUFE} Einkäufe.`);
  pruefeBezug(z, input);
  aendere(z, 'einkauf-neu', { name: input.name }, () => {
    z.planung.einkaeufe.push({
      id: neueId(),
      etag: neuesEtag(),
      position: Math.max(0, ...z.planung.einkaeufe.map((e) => e.position)) + 1,
      ...input,
      posten: [],
      regeln: [],
    });
  });
}

/** Changes (`input`) or deletes (null, with the `einkaufStand`) a shopping trip. */
export function einkaufAendern(
  z: MockZugang,
  id: number,
  input: EinkaufInput | null,
  ifMatch: unknown
): void {
  const einkauf = einkaufVon(z, id);
  if (!input) {
    if (einkaufStand(einkauf) !== ifMatch) throw konflikt();
    aendere(z, 'einkauf-geloescht', { name: einkauf.name }, () => {
      z.planung.einkaeufe.splice(z.planung.einkaeufe.indexOf(einkauf), 1);
      // Things moved here go back, unless another trip still has them moved to it
      const mit = (e: typeof einkauf, zutat: number) =>
        e.regeln.some((r) => r.art === 'mit' && r.planungZutatId === zutat);
      const zurueck = einkauf.regeln
        .filter((r) => r.art === 'mit')
        .map((r) => r.planungZutatId)
        .filter((zutat) => !z.planung.einkaeufe.some((e) => mit(e, zutat)));
      for (const anderer of z.planung.einkaeufe)
        anderer.regeln = anderer.regeln.filter(
          (r) => r.art !== 'ohne' || !zurueck.includes(r.planungZutatId)
        );
    });
    return;
  }
  const geprueft = pruefeBezug(z, input, einkauf.bisMahlzeitId);
  if (einkauf.etag !== ifMatch) throw konflikt();
  const details = {
    name: input.name,
    ...(einkauf.abgeschlossen !== input.abgeschlossen
      ? { abgeschlossen: input.abgeschlossen }
      : {}),
  };
  aendere(z, 'einkauf-geaendert', details, () => {
    Object.assign(einkauf, geprueft, { etag: neuesEtag() });
  });
}

function gleicheArt(a: GerichtEinheit, b: GerichtEinheit): boolean {
  return Object.values(EINHEITEN_JE_ART).some((liste) => liste.includes(a) && liste.includes(b));
}

function zutatMitEinheit(z: MockZugang, planungZutatId: number, einheit: GerichtEinheit | null) {
  if (!z.planung.zutaten.some((zutat) => zutat.id === planungZutatId))
    throw feld('planungZutatId', 'Diese Zutat gibt es nicht mehr. Bitte lade die Seite neu.');
  const zutat = zutatFuer(z, { planungZutatId }, { lebensmittel: false });
  if (!einheitPasst(zutat.einheitenart, einheit))
    throw feld('einheit', `${zutat.name} wird in einer anderen Einheit gemessen.`);
  return zutat;
}

export function postenAbhaken(
  z: MockZugang,
  einkaufId: number,
  input: HakenInput,
  etag: string | null
): void {
  const einkauf = einkaufVon(z, einkaufId);
  const zutat = zutatMitEinheit(z, input.planungZutatId, input.einheit);
  const vorhanden = einkauf.posten.find(
    (p) => p.planungZutatId === input.planungZutatId && gleicheArt(p.einheit, input.einheit)
  );
  if (etag === null ? vorhanden : vorhanden?.etag !== etag) throw konflikt();
  if (!vorhanden && einkauf.posten.length >= MAX_EINKAUF_EINTRAEGE)
    throw feld('planungZutatId', 'Dieser Einkauf ist voll.');
  const details = {
    name: zutat.name,
    einkauf: einkauf.name,
    ...(input.ersatz ? { ersatz: input.ersatz } : {}),
  };
  aendere(z, 'einkauf-abgehakt', details, () => {
    const werte = {
      ...input,
      etag: neuesEtag(),
      von: z.mitglied?.name ?? '',
      am: new Date().toISOString(),
    };
    if (vorhanden) Object.assign(vorhanden, werte);
    else einkauf.posten.push({ id: neueId(), ...werte });
  });
}

export function postenAufheben(z: MockZugang, id: number, ifMatch: unknown): void {
  const einkauf = z.planung.einkaeufe.find((e) => e.posten.some((p) => p.id === id));
  if (!einkauf) throw nichtGefunden();
  const posten = einkauf.posten.find((p) => p.id === id)!;
  if (posten.etag !== ifMatch) throw konflikt();
  const name = zutatFuer(
    z,
    { planungZutatId: posten.planungZutatId },
    { lebensmittel: false }
  ).name;
  aendere(z, 'einkauf-aufgehoben', { name, einkauf: einkauf.name }, () => {
    einkauf.posten.splice(einkauf.posten.indexOf(posten), 1);
  });
}

function schreibeRegel(z: MockZugang, einkaufId: number, input: RegelInput): void {
  const einkauf = einkaufVon(z, einkaufId);
  einkauf.regeln = einkauf.regeln.filter((r) => r.planungZutatId !== input.planungZutatId);
  if (input.art === null) return;
  if (einkauf.regeln.length >= MAX_EINKAUF_EINTRAEGE)
    throw feld('planungZutatId', 'Dieser Einkauf hat zu viele Regeln.');
  einkauf.regeln.push({
    planungZutatId: input.planungZutatId,
    art: input.art,
    menge: input.menge,
    einheit: input.einheit,
  });
}

export function regelSetzen(z: MockZugang, einkaufId: number, input: RegelInput): void {
  const einkauf = einkaufVon(z, einkaufId);
  const zutat = zutatMitEinheit(z, input.planungZutatId, input.einheit);
  aendere(z, 'einkauf-regel', { name: zutat.name, einkauf: einkauf.name, regel: input.art }, () =>
    schreibeRegel(z, einkaufId, input)
  );
}

export function verschieben(z: MockZugang, vonEinkaufId: number, input: VerschiebenInput): void {
  const von = einkaufVon(z, vonEinkaufId);
  if (input.nachEinkaufId === vonEinkaufId)
    throw feld('nachEinkaufId', 'Bitte einen anderen Einkauf wählen.');
  const nach = z.planung.einkaeufe.find((e) => e.id === input.nachEinkaufId);
  if (!nach) throw feld('nachEinkaufId', 'Diesen Einkauf gibt es nicht mehr.');
  if (nach.abgeschlossen)
    throw feld(
      'nachEinkaufId',
      'Dieser Einkauf ist schon abgeschlossen. Bitte wähle einen anderen.'
    );
  if (nach.posten.some((p) => p.planungZutatId === input.planungZutatId))
    throw feld(
      'nachEinkaufId',
      'In diesem Einkauf ist das schon abgehakt. Bitte wähle einen anderen.'
    );
  const zutat = zutatMitEinheit(z, input.planungZutatId, null);
  const regel = { planungZutatId: input.planungZutatId, menge: null, einheit: null };
  aendere(z, 'einkauf-verschoben', { name: zutat.name, einkauf: von.name, nach: nach.name }, () => {
    schreibeRegel(z, vonEinkaufId, { ...regel, art: 'ohne' });
    schreibeRegel(z, input.nachEinkaufId, { ...regel, art: 'mit' });
  });
}

/** Takes back „not on this trip“ with the „mit“ of the trip it was moved to, in one change. */
export function zurueckholen(z: MockZugang, einkaufId: number, input: ZurueckholenInput): void {
  const einkauf = einkaufVon(z, einkaufId);
  const zutat = zutatMitEinheit(z, input.planungZutatId, null);
  const ist = (art: 'ohne' | 'mit') => (r: { planungZutatId: number; art: string }) =>
    r.planungZutatId === input.planungZutatId && r.art === art;
  if (!einkauf.regeln.some(ist('ohne')))
    throw feld('planungZutatId', `${zutat.name} ist in diesem Einkauf nicht herausgenommen.`);
  aendere(z, 'einkauf-zurueckgeholt', { name: zutat.name, einkauf: einkauf.name }, () => {
    einkauf.regeln = einkauf.regeln.filter((r) => !ist('ohne')(r));
    for (const anderer of z.planung.einkaeufe)
      anderer.regeln = anderer.regeln.filter((r) => !ist('mit')(r));
  });
}
