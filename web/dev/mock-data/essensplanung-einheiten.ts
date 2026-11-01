/**
 * „Einheiten vereinheitlichen“ in the mock API: the demo AI proposes a unit in household amounts
 * with fixed factors, read with the same function as the API (`essen-ki-einheiten-antwort.ts`),
 * and the converted amounts are saved all or none, like `api/lib/essen-einheiten.ts`.
 */
import type { EinheitenZeileInput, KiEinheiten } from '../../../api/lib/essen-einheiten-model';
import { einheitenVorkommen, vorkommendeEinheiten } from '../../../api/lib/essen-einheiten-model';
import { einheitSchluessel } from '../../../api/lib/essen-gerichte-model';
import { leseKiEinheiten } from '../../../api/lib/essen-ki-einheiten-antwort';
import { gerichteAnsicht } from './essensplanung-gerichte';
import { MockKiBesetzt } from './essensplanung-ki';
import type { MockZugang } from './essensplanung-planung';
import {
  MockPlanungFehler,
  aendere,
  konflikt,
  neuesEtag,
  nichtGefunden,
} from './essensplanung-planung';

/** Grams of one of a unit, as the demo AI estimates them. */
const GRAMM: Record<string, number> = {
  bund: 20,
  el: 12,
  tl: 4,
  prise: 0.5,
  stueck: 100,
  dose: 400,
  packung: 500,
  zehe: 4,
};

function stand(z: MockZugang) {
  return {
    gerichte: gerichteAnsicht(z.planung).gerichte,
    zusatzbedarf: z.planung.zusatzbedarf,
    bestand: z.planung.bestand,
  };
}

/** Herbs in Bund, everything else in g, with the demo's grams per unit. */
export function kiEinheiten(z: MockZugang, planungZutatId: number, wartung: boolean): KiEinheiten {
  if (z.zugang === 'lesen')
    throw new MockPlanungFehler(
      403,
      'NUR_LESEN',
      'Mit diesem Link kannst du die Planung nur ansehen.'
    );
  if (wartung)
    throw new MockPlanungFehler(503, 'MAINTENANCE', 'Die Essensplanung wird gerade gewartet.');
  const zutat = gerichteAnsicht(z.planung).zutaten.find((entry) => entry.id === planungZutatId);
  if (!zutat) throw nichtGefunden();
  if (/KI-Fehler/i.test(zutat.name)) throw new MockKiBesetzt();
  const vorkommen = einheitenVorkommen(stand(z), planungZutatId);
  const einheiten = vorkommendeEinheiten(vorkommen);
  if (einheiten.length < 2)
    throw new MockPlanungFehler(
      400,
      'INVALID',
      `${zutat.name} steht schon in einer Einheit. Lade die Seite neu, wenn du etwas anderes siehst.`
    );
  const imBund = einheiten.some((einheit) => einheitSchluessel(einheit) === 'bund');
  const ziel = imBund ? 'Bund' : 'g';
  const gramm = (einheit: string) =>
    einheitSchluessel(einheit) === 'g' ? 1 : GRAMM[einheitSchluessel(einheit)];
  return leseKiEinheiten(
    {
      ziel,
      begruendung: imBund
        ? 'Kräuter misst man in Bund; ein Bund wiegt etwa 20 g (Beispielwert der Demo-KI).'
        : 'In Gramm lässt es sich am besten abwiegen (Beispielwert der Demo-KI).',
      faktoren: einheiten.map((einheit) => {
        const g = gramm(einheit);
        return { einheit, faktor: g === undefined ? null : imBund ? g / 20 : g };
      }),
    },
    planungZutatId,
    vorkommen
  );
}

/** Saves the converted amounts of one ingredient, all or none; a changed one is a conflict. */
export function einheitenUebernehmen(
  z: MockZugang,
  planungZutatId: number,
  zeilen: EinheitenZeileInput[]
): void {
  const zutat = gerichteAnsicht(z.planung).zutaten.find((entry) => entry.id === planungZutatId);
  if (!zutat) throw nichtGefunden();
  const ziele = zeilen.map((zeile) => {
    const liste =
      zeile.stelle === 'gericht'
        ? z.planung.gerichte.flatMap((gericht) => gericht.zutaten)
        : z.planung[zeile.stelle];
    const ziel = liste.find(
      (entry) =>
        entry.id === zeile.id && entry.planungZutatId === planungZutatId && entry.menge !== null
    );
    if (!ziel || ziel.etag !== zeile.etag) throw konflikt();
    return { ziel, zeile };
  });
  aendere(z, 'einheiten-vereinheitlicht', { name: zutat.name, anzahl: zeilen.length }, () => {
    for (const { ziel, zeile } of ziele)
      Object.assign(ziel, { menge: zeile.menge, einheit: zeile.einheit, etag: neuesEtag() });
  });
}
