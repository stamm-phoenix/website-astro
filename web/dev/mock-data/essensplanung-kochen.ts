/**
 * Ticking off planned dishes in the mock API, like `api/lib/essen-kochen.ts`.
 */
import type { AbhakenInput } from '../../../api/lib/essen-kochen-model';
import type { MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neuesEtag, nichtGefunden } from './essensplanung-planung';

/** Sets a planned dish to cooked (with what it used), left out or open again. */
export function einplanungAbhaken(
  z: MockZugang,
  id: number,
  input: AbhakenInput,
  ifMatch: unknown
): void {
  const ort = z.planung.tage
    .flatMap((tag) => tag.mahlzeiten.map((mahlzeit) => ({ tag, mahlzeit })))
    .find(({ mahlzeit }) => mahlzeit.einplanungen.some((e) => e.id === id));
  if (!ort) throw nichtGefunden();
  const einplanung = ort.mahlzeit.einplanungen.find((e) => e.id === id)!;
  if (
    input.verbrauch.some((v) => !z.planung.zutaten.some((zutat) => zutat.id === v.planungZutatId))
  )
    throw feld('verbrauch', 'Eine der Zutaten gibt es nicht mehr. Bitte lade die Seite neu.');
  if (einplanung.etag !== ifMatch) throw konflikt();
  const gericht = z.planung.gerichte.find((g) => g.id === einplanung.gerichtId)!;
  const details = {
    name: gericht.name,
    mahlzeit: ort.mahlzeit.name,
    datum: ort.tag.datum,
    status: input.status,
  };
  aendere(z, 'einplanung-abgehakt', details, () => {
    Object.assign(einplanung, {
      etag: neuesEtag(),
      status: input.status,
      verbrauch: input.verbrauch.map((v) => ({ ...v })),
    });
  });
}
