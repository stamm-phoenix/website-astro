/**
 * Views, search and labels of the module „Nami-Abgleich“ (`docs/nami-abgleich.md`). The
 * comparison itself runs in the API (`api/lib/nami-abgleich.ts`).
 */
import type {
  AbgleichPaar,
  AbgleichPerson,
  AbgleichVerbindung,
  NamiAbgleichData,
} from '../../../api/lib/nami-abgleich-model';

export type {
  AbgleichFeld,
  AbgleichPaar,
  AbgleichPerson,
  NamiAbgleichData,
} from '../../../api/lib/nami-abgleich-model';

export type NamiAbgleichAnsicht = 'unterschiede' | 'nur-nami' | 'nur-campflow' | 'gleich';

export const ANSICHTEN: { value: NamiAbgleichAnsicht; label: string }[] = [
  { value: 'unterschiede', label: 'Mit Unterschieden' },
  { value: 'nur-nami', label: 'Nur in NaMi' },
  { value: 'nur-campflow', label: 'Nur in CampFlow' },
  { value: 'gleich', label: 'Übereinstimmend' },
];

/** Pairs found by a weak key; a person should check that they really are the same. */
export function unsicher(verbindung: AbgleichVerbindung): boolean {
  return verbindung === 'geburtsdatum' || verbindung === 'name';
}

export const VERBINDUNG_LABEL: Record<AbgleichVerbindung, string> = {
  mitgliedsnummer: 'Gefunden über die Mitgliedsnummer',
  'name-geburtsdatum': 'Gefunden über Name und Geburtsdatum',
  geburtsdatum: 'Nur über Geburtsdatum und einen Namen gefunden',
  name: 'Nur über den Namen gefunden',
};

export function unterschiede(paar: AbgleichPaar): number {
  return paar.felder.filter((feld) => !feld.gleich).length;
}

/** A pair to check: it has differences or was found by a weak key. */
function zuPruefen(paar: AbgleichPaar): boolean {
  return unterschiede(paar) > 0 || unsicher(paar.verbindung);
}

function fold(value: string): string {
  return value
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export function personName(person: AbgleichPerson): string {
  return [person.vorname, person.nachname].filter(Boolean).join(' ') || 'Ohne Namen';
}

function passt(person: AbgleichPerson, suche: string): boolean {
  const query = fold(suche.trim());
  if (!query) return true;
  return [personName(person), person.mitgliedsnummer].some((value) => fold(value).includes(query));
}

/** Whether the pair or person belongs in the list while former members are hidden. */
function sichtbar(personen: AbgleichPerson[], ausgetretene: boolean): boolean {
  return ausgetretene || personen.some((person) => person.aktiv);
}

export interface Filter {
  suche: string;
  /** Show people who left in every list they are in. */
  ausgetretene: boolean;
}

export function paareIn(
  data: NamiAbgleichData,
  ansicht: 'unterschiede' | 'gleich',
  filter: Filter
): AbgleichPaar[] {
  return data.paare.filter(
    (paar) =>
      zuPruefen(paar) === (ansicht === 'unterschiede') &&
      sichtbar([paar.nami, paar.campflow], filter.ausgetretene) &&
      (passt(paar.nami, filter.suche) || passt(paar.campflow, filter.suche))
  );
}

export function personenIn(
  data: NamiAbgleichData,
  ansicht: 'nur-nami' | 'nur-campflow',
  filter: Filter
): AbgleichPerson[] {
  const personen = ansicht === 'nur-nami' ? data.nurNami : data.nurCampflow;
  return personen.filter(
    (person) => sichtbar([person], filter.ausgetretene) && passt(person, filter.suche)
  );
}

export function anzahl(
  data: NamiAbgleichData,
  ansicht: NamiAbgleichAnsicht,
  filter: Filter
): number {
  return ansicht === 'unterschiede' || ansicht === 'gleich'
    ? paareIn(data, ansicht, filter).length
    : personenIn(data, ansicht, filter).length;
}
