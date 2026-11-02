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

const gleich = (a: string, b: string) => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de');
const rund = (menge: number) => Math.round(menge * 1000) / 1000;

/**
 * Saves the converted amounts of one ingredient, all or none, like the API: lines, extra needs
 * and stock, what cooked dishes used, what trips bought and fixed amounts on trips. Entries of a
 * dish or a trip that end up in the same unit are added up; a changed one is a conflict.
 */
export function einheitenUebernehmen(
  z: MockZugang,
  planungZutatId: number,
  zeilen: EinheitenZeileInput[]
): void {
  const zutat = gerichteAnsicht(z.planung).zutaten.find((entry) => entry.id === planungZutatId);
  if (!zutat) throw nichtGefunden();
  const einplanungen = z.planung.tage.flatMap((tag) =>
    tag.mahlzeiten.flatMap((mahlzeit) => mahlzeit.einplanungen)
  );
  const aenderungen: (() => void)[] = [];
  for (const zeile of zeilen) {
    if (zeile.stelle === 'verbrauch') {
      const einplanung = einplanungen.find((e) => e.id === zeile.id);
      const eintrag = einplanung?.verbrauch.find(
        (v) => v.planungZutatId === planungZutatId && gleich(v.einheit, zeile.von)
      );
      if (!einplanung || einplanung.etag !== zeile.etag || !eintrag) throw konflikt();
      aenderungen.push(() =>
        Object.assign(eintrag, { menge: zeile.menge, einheit: zeile.einheit })
      );
    } else if (zeile.stelle === 'erhalten') {
      const haken = z.planung.einkaeufe
        .flatMap((e) => e.posten)
        .find((p) => p.id === zeile.id && p.planungZutatId === planungZutatId);
      if (!haken || haken.etag !== zeile.etag) throw konflikt();
      aenderungen.push(() =>
        Object.assign(haken, { erhalten: zeile.menge, einheit: zeile.einheit })
      );
    } else if (zeile.stelle === 'fest') {
      const einkauf = z.planung.einkaeufe.find((e) => e.id === zeile.id);
      const regel = einkauf?.regeln.find(
        (r) => r.planungZutatId === planungZutatId && r.art === 'fest'
      );
      if (!einkauf || einkauf.etag !== zeile.etag || !regel) throw konflikt();
      aenderungen.push(() => {
        Object.assign(regel, { menge: zeile.menge, einheit: zeile.einheit });
        einkauf.etag = neuesEtag();
      });
    } else {
      const liste =
        zeile.stelle === 'gericht'
          ? z.planung.gerichte.flatMap((gericht) => gericht.zutaten)
          : z.planung[zeile.stelle];
      const ziel = liste.find(
        (entry) =>
          entry.id === zeile.id && entry.planungZutatId === planungZutatId && entry.menge !== null
      );
      if (!ziel || ziel.etag !== zeile.etag) throw konflikt();
      aenderungen.push(() =>
        Object.assign(ziel, { menge: zeile.menge, einheit: zeile.einheit, etag: neuesEtag() })
      );
    }
  }
  aendere(z, 'einheiten-vereinheitlicht', { name: zutat.name, anzahl: zeilen.length }, () => {
    for (const aenderung of aenderungen) aenderung();
    // Entries of a dish in the same unit are added up, and the dish gets a new version
    for (const einplanung of einplanungen.filter((e) =>
      zeilen.some((zeile) => zeile.stelle === 'verbrauch' && zeile.id === e.id)
    )) {
      const zusammen: typeof einplanung.verbrauch = [];
      for (const v of einplanung.verbrauch) {
        const gleicher = zusammen.find(
          (w) => w.planungZutatId === v.planungZutatId && gleich(w.einheit, v.einheit)
        );
        if (gleicher) gleicher.menge = rund(gleicher.menge + v.menge);
        else zusammen.push({ ...v });
      }
      einplanung.verbrauch = zusammen;
      einplanung.etag = neuesEtag();
    }
    // Things of a trip in the same unit become one, as in the API
    for (const einkauf of z.planung.einkaeufe) {
      const behalten: typeof einkauf.posten = [];
      for (const p of einkauf.posten) {
        const gleicher = behalten.find(
          (q) => q.planungZutatId === p.planungZutatId && gleich(q.einheit, p.einheit)
        );
        if (!gleicher) {
          behalten.push(p);
          continue;
        }
        gleicher.erhalten = rund(gleicher.erhalten + p.erhalten);
        gleicher.ersatz = [...new Set([gleicher.ersatz, p.ersatz].filter(Boolean))].join(', ');
        gleicher.etag = neuesEtag();
        // The newest tick of those merged counts as when it was ticked off
        if ((p.stand ?? p.etag) > (gleicher.stand ?? gleicher.etag))
          gleicher.stand = p.stand ?? p.etag;
      }
      if (behalten.length !== einkauf.posten.length) einkauf.posten = behalten;
      for (const p of einkauf.posten)
        if (zeilen.some((zeile) => zeile.stelle === 'erhalten' && zeile.id === p.id))
          p.etag = neuesEtag();
    }
  });
}
