/**
 * „Zutaten prüfen (KI)“ in the mock API: a fixed demo answer instead of a model, read with the
 * same function as the API (`api/lib/essen-ki-zutaten-antwort.ts`). The demo AI corrects
 * „Spagetti“, gives open details a spice category and weight, takes unknown diets as
 * vegetarian, does not understand names with „Dings“ or „Zeug“, leaves out names with
 * „vergessen“ and fills a missing grams per TL of central sugar and salt with 4 g. „KI-Fehler“ in a name
 * answers 429 like a busy deployment.
 */
import type { KiZutatEingabe, KiZutatListen } from '../../../api/lib/essen-ki-zutaten-antwort';
import {
  kiEingabeDerPlanung,
  kiEingabeZentral,
  kiZutatenAnfrage,
  leseKiZutaten,
} from '../../../api/lib/essen-ki-zutaten-antwort';
import type { KiZutatPruefung } from '../../../api/lib/essen-ki-zutaten-model';
import { essenKatalog, essenSteuerungView } from './essensplanung';
import { gerichteAnsicht } from './essensplanung-gerichte';
import { MockKiBesetzt } from './essensplanung-ki';
import type { MockZugang } from './essensplanung-planung';
import { MockPlanungFehler } from './essensplanung-planung';

function demoAntwort(
  eingaben: readonly KiZutatEingabe[],
  listen: KiZutatListen,
  offen: ReadonlySet<string>
): unknown {
  const anfrage = kiZutatenAnfrage(eingaben, listen, offen);
  const gewuerze =
    listen.kategorien.find((k) => /gewürz/i.test(k.name))?.name ?? anfrage.kategorien[0];
  return {
    zutaten: anfrage.zutaten
      .filter((zutat) => !/vergessen/i.test(zutat.name))
      .map((zutat) => {
        const verstanden = !/dings|zeug/i.test(zutat.name);
        const masse = zutat.angaben_offen ? 'masse' : zutat.einheitenart;
        return {
          schluessel: zutat.schluessel,
          verstanden,
          grund: verstanden
            ? ''
            : `Was ist mit „${zutat.name}“ gemeint? Schreib die Zutat genauer.`,
          name: zutat.name.replace(/Spagetti/i, 'Spaghetti'),
          kategorie: zutat.kategorie ?? gewuerze,
          einheitenart: masse,
          lebensmittel: zutat.lebensmittel,
          vegetarisch: zutat.vegetarisch ?? true,
          vegan: zutat.vegan,
          allergene: zutat.allergene,
          gramm_pro_tl:
            'gramm_pro_tl' in zutat
              ? (zutat.gramm_pro_tl ?? (/zucker|salz/i.test(zutat.name) ? 4 : null))
              : null,
          gramm_pro_el: 'gramm_pro_el' in zutat ? zutat.gramm_pro_el : null,
          gramm_pro_stueck: 'gramm_pro_stueck' in zutat ? zutat.gramm_pro_stueck : null,
          begruendung: 'Demo-KI: Angaben ergänzt.',
        };
      }),
  };
}

function frage(
  eingaben: KiZutatEingabe[],
  listen: KiZutatListen,
  offen: ReadonlySet<string> = new Set()
): KiZutatPruefung {
  if (eingaben.some((e) => /KI-Fehler/i.test(e.werte.name))) throw new MockKiBesetzt();
  return leseKiZutaten(demoAntwort(eingaben, listen, offen), eingaben, listen);
}

/** Like `zutatenDerPlanungPruefen`: the own ingredients of the Planung with these ids. */
export function kiZutatenDerPlanung(
  z: MockZugang,
  ids: readonly number[],
  wartung: boolean
): KiZutatPruefung {
  if (z.zugang === 'lesen')
    throw new MockPlanungFehler(
      403,
      'NUR_LESEN',
      'Mit diesem Link kannst du die Planung nur ansehen.'
    );
  if (wartung)
    throw new MockPlanungFehler(503, 'MAINTENANCE', 'Die Essensplanung wird gerade gewartet.');
  const gewaehlt = gerichteAnsicht(z.planung).zutaten.filter(
    (zutat) => zutat.zutatId === null && ids.includes(zutat.id)
  );
  const offen = new Set(
    gewaehlt.filter((zutat) => zutat.angabenOffen).map((zutat) => `p${zutat.id}`)
  );
  return frage(gewaehlt.map(kiEingabeDerPlanung), essenKatalog(), offen);
}

/** Like `zentraleZutatenPruefen`. */
export function kiZentraleZutaten(ids: readonly number[]): KiZutatPruefung {
  const view = essenSteuerungView();
  return frage(view.zutaten.filter((zutat) => ids.includes(zutat.id)).map(kiEingabeZentral), view);
}
