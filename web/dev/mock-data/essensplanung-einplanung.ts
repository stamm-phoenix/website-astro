/**
 * Dishes planned at the meals of a Planung in the mock API, like `api/lib/essen-einplanung.ts`:
 * plan (also right with a new dish), change, move, copy and take off.
 */
import { MAX_EINPLANUNGEN_PRO_MAHLZEIT } from '../../../api/lib/essen-planung-model';
import type { EinplanungInput } from '../../../api/lib/essen-planung-model';
import type { MockEinplanung, MockMahlzeit, MockTag, MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neueId, neuesEtag, nichtGefunden } from './essensplanung-planung';

function sortiereEinplanungen(
  mahlzeit: MockMahlzeit,
  einplanung?: MockEinplanung,
  position?: number
) {
  const rest = mahlzeit.einplanungen
    .filter((e) => e !== einplanung)
    .sort((a, b) => a.position - b.position);
  if (einplanung)
    rest.splice(
      Math.min(Math.max((position ?? rest.length + 1) - 1, 0), rest.length),
      0,
      einplanung
    );
  rest.forEach((e, index) => {
    if (e.position !== index + 1) {
      e.position = index + 1;
      e.etag = neuesEtag();
    }
  });
  mahlzeit.einplanungen = rest;
}

/** The meal of a planned dish and who is responsible, checked like the API. */
function pruefeMahlzeit(
  z: MockZugang,
  input: Omit<EinplanungInput, 'gerichtId'>,
  bisher: number | null = null
): { tag: MockTag; mahlzeit: MockMahlzeit } {
  const ziel = z.planung.tage
    .flatMap((tag) => tag.mahlzeiten.map((mahlzeit) => ({ tag, mahlzeit })))
    .find(({ mahlzeit }) => mahlzeit.id === input.mahlzeitId);
  if (!ziel) throw feld('mahlzeitId', 'Diese Mahlzeit gibt es nicht mehr.');
  if (
    input.zustaendigId !== null &&
    input.zustaendigId !== bisher &&
    !z.planung.mitglieder.some((m) => m.id === input.zustaendigId && !m.entzogen)
  )
    throw feld('zustaendigId', 'Bitte aus der Liste wählen.');
  return ziel;
}

function pruefeEinplanung(z: MockZugang, input: EinplanungInput, bisher: number | null = null) {
  const ziel = z.planung.tage
    .flatMap((tag) => tag.mahlzeiten)
    .some((mahlzeit) => mahlzeit.id === input.mahlzeitId);
  const gericht = z.planung.gerichte.find((g) => g.id === input.gerichtId);
  if (ziel && !gericht) throw feld('gerichtId', 'Dieses Gericht gibt es nicht mehr.');
  return { ...pruefeMahlzeit(z, input, bisher), gericht: gericht! };
}

function platz(mahlzeit: MockMahlzeit): void {
  if (mahlzeit.einplanungen.length >= MAX_EINPLANUNGEN_PRO_MAHLZEIT)
    throw feld('mahlzeitId', `Höchstens ${MAX_EINPLANUNGEN_PRO_MAHLZEIT} Gerichte pro Mahlzeit.`);
}

/**
 * Checks where a new dish goes, before it is created (`essensplanung-gerichte.ts`); returns how
 * to add it there in the same change.
 */
export function einplanungVorbereiten(
  z: MockZugang,
  input: Omit<EinplanungInput, 'gerichtId'>
): { details: { mahlzeit: string; datum: string }; einfuegen: (gerichtId: number) => void } {
  const { tag, mahlzeit } = pruefeMahlzeit(z, input);
  platz(mahlzeit);
  return {
    details: { mahlzeit: mahlzeit.name, datum: tag.datum },
    einfuegen: (gerichtId) => fuegeEin(mahlzeit, { ...input, gerichtId }),
  };
}

function fuegeEin(mahlzeit: MockMahlzeit, input: EinplanungInput, position?: number): void {
  const einplanung: MockEinplanung = {
    id: neueId(),
    etag: neuesEtag(),
    gerichtId: input.gerichtId,
    position: mahlzeit.einplanungen.length + 1,
    faktor: input.faktor,
    zustaendigId: input.zustaendigId,
    zustaendigText: input.zustaendigId === null ? input.zustaendigText : '',
    status: 'offen',
    verbrauch: [],
  };
  mahlzeit.einplanungen.push(einplanung);
  sortiereEinplanungen(mahlzeit, einplanung, position);
}

/** Plans a dish at a meal, like `essen-einplanung.ts`. */
export function einplanen(z: MockZugang, input: EinplanungInput, position?: number): void {
  const { tag, mahlzeit, gericht } = pruefeEinplanung(z, input);
  platz(mahlzeit);
  const details = { name: gericht.name, mahlzeit: mahlzeit.name, datum: tag.datum };
  aendere(z, 'einplanung-neu', details, () => fuegeEin(mahlzeit, input, position));
}

/** Changes, moves (`input`) or deletes (null) a planned dish. */
export function einplanungAendern(
  z: MockZugang,
  id: number,
  input: EinplanungInput | null,
  ifMatch: unknown,
  position?: number
): void {
  const quelle = z.planung.tage
    .flatMap((tag) => tag.mahlzeiten.map((mahlzeit) => ({ tag, mahlzeit })))
    .find(({ mahlzeit }) => mahlzeit.einplanungen.some((e) => e.id === id));
  if (!quelle) throw nichtGefunden();
  const einplanung = quelle.mahlzeit.einplanungen.find((e) => e.id === id)!;
  const gericht = z.planung.gerichte.find((g) => g.id === einplanung.gerichtId)!;
  if (!input) {
    if (einplanung.etag !== ifMatch) throw konflikt();
    const details = { name: gericht.name, mahlzeit: quelle.mahlzeit.name, datum: quelle.tag.datum };
    aendere(z, 'einplanung-geloescht', details, () => {
      quelle.mahlzeit.einplanungen.splice(quelle.mahlzeit.einplanungen.indexOf(einplanung), 1);
      sortiereEinplanungen(quelle.mahlzeit);
    });
    return;
  }
  const { tag, mahlzeit } = pruefeEinplanung(
    z,
    { ...input, gerichtId: einplanung.gerichtId },
    einplanung.zustaendigId
  );
  const verschoben = mahlzeit !== quelle.mahlzeit;
  if (verschoben) platz(mahlzeit);
  if (einplanung.etag !== ifMatch) throw konflikt();
  const details = {
    name: gericht.name,
    mahlzeit: mahlzeit.name,
    datum: tag.datum,
    ...(verschoben ? { verschoben: true } : {}),
  };
  aendere(z, 'einplanung-geaendert', details, () => {
    Object.assign(einplanung, {
      etag: neuesEtag(),
      faktor: input.faktor,
      zustaendigId: input.zustaendigId,
      zustaendigText: input.zustaendigId === null ? input.zustaendigText : '',
    });
    if (verschoben) {
      quelle.mahlzeit.einplanungen.splice(quelle.mahlzeit.einplanungen.indexOf(einplanung), 1);
      sortiereEinplanungen(quelle.mahlzeit);
      mahlzeit.einplanungen.push(einplanung);
      sortiereEinplanungen(mahlzeit, einplanung, position);
    } else if (position !== undefined) sortiereEinplanungen(mahlzeit, einplanung, position);
  });
}
