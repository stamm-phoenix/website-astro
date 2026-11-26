import type { Db } from './db';
import { getDb } from './db';
import { EINHEITENARTEN } from './essen-schema';
import { ladeGerichte, ladeKatalog } from './essen-gerichte';
import { DATEN, KI_AUS, ZAHL_ODER_NULL, frage, isKiConfigured, pruefeKiZugang } from './essen-ki';
import type { KiZutatEingabe, KiZutatListen } from './essen-ki-zutaten-antwort';
import {
  kiEingabeDerPlanung,
  kiEingabeZentral,
  kiZutatenAnfrage,
  leseKiZutaten,
} from './essen-ki-zutaten-antwort';
import type { KiZutatPruefung } from './essen-ki-zutaten-model';

import { listKategorien, listUnvertraeglichkeiten, listZutaten } from './essen-steuerung';
import type { Zugang } from './essen-zugang';

/**
 * „Zutaten prüfen (KI)“ (`docs/essensplanung.md`, „KI“): the AI checks category, kind of unit,
 * diet, allergens and, for the central list, the conversion help of up to `MAX_KI_ZUTATEN`
 * ingredients per question. Nothing is saved here; the page shows the proposals and saves what
 * the user takes over with the usual endpoints.
 */

const BOOL_ODER_NULL = { type: ['boolean', 'null'] };

function schema(listen: KiZutatListen) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['zutaten'],
    properties: {
      zutaten: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'schluessel',
            'verstanden',
            'grund',
            'name',
            'kategorie',
            'einheitenart',
            'lebensmittel',
            'vegetarisch',
            'vegan',
            'allergene',
            'gramm_pro_tl',
            'gramm_pro_el',
            'gramm_pro_stueck',
            'begruendung',
          ],
          properties: {
            schluessel: { type: 'string' },
            verstanden: { type: 'boolean' },
            grund: { type: 'string' },
            name: { type: 'string' },
            kategorie: {
              anyOf: [
                { type: 'string', enum: listen.kategorien.map((k) => k.name) },
                { type: 'null' },
              ],
            },
            einheitenart: { type: 'string', enum: [...EINHEITENARTEN] },
            lebensmittel: { type: 'boolean' },
            vegetarisch: BOOL_ODER_NULL,
            vegan: BOOL_ODER_NULL,
            allergene: {
              type: 'array',
              items: { type: 'string', enum: listen.unvertraeglichkeiten.map((u) => u.name) },
            },
            gramm_pro_tl: ZAHL_ODER_NULL,
            gramm_pro_el: ZAHL_ODER_NULL,
            gramm_pro_stueck: ZAHL_ODER_NULL,
            begruendung: { type: 'string' },
          },
        },
      },
    },
  };
}

const PROMPT = `Du prüfst Zutaten für die Essensplanung eines Zeltlagers der Pfadfinder in Deutschland. Gib für jede Zutat in "zutaten" genau einen Eintrag mit ihrem "schluessel" zurück, auch wenn alles passt.
- "verstanden": false, wenn du nicht sicher erkennst, welches Lebensmittel oder welcher Gegenstand gemeint ist, z. B. weil der Name zu umgangssprachlich, zu ungenau, ein Insider oder unleserlich ist. Dann erkläre in "grund" in einem kurzen deutschen Satz, was unklar ist und wie man es eindeutiger schreibt, und gib alle anderen Felder unverändert zurück. Rate nie.
- Sonst "verstanden": true, "grund" leer, und gib die richtigen Werte zurück:
  - "name": der Name mit korrigierter Rechtschreibung und üblicher Schreibweise (z. B. "Spagetti" → "Spaghetti"); ändere die Bedeutung nie und lass ihn sonst unverändert.
  - "kategorie": die passende aus "kategorien", wie im Supermarkt. Ist "angaben_offen" true, wurde die Kategorie geraten: wähle sie neu.
  - "einheitenart": worin man die Zutat üblicherweise abmisst: masse (g/kg), volumen (ml/l), stueck, packung oder bund. Ist "angaben_offen" true, wähle sie neu.
  - "lebensmittel": false nur für Dinge, die man nicht isst (Spülmittel, Alufolie, Gas).
  - "vegetarisch" und "vegan": true oder false nach der üblichen Zutat; vegan schließt vegetarisch ein; null nur, wenn es wirklich vom Produkt abhängt.
  - "allergene": die enthaltenen aus "allergene" nach der üblichen Zutat (z. B. Weizenmehl enthält Gluten); leere Liste, wenn keine.
  - "gramm_pro_tl", "gramm_pro_el", "gramm_pro_stueck": nur wenn die Zutat sie in der Anfrage hat und in masse gemessen wird: Gramm für einen gestrichenen TL, einen gestrichenen EL bzw. ein durchschnittliches Stück; null, wo es nicht sinnvoll ist (z. B. Stück bei Mehl). Behalte vorhandene Werte, wenn sie plausibel sind.
- "begruendung": ein kurzer deutscher Satz, was du geändert hast und warum; leer, wenn alles passt.
Ändere nur, was wirklich falsch ist oder fehlt. ${DATEN}`;

/** Asks the AI about the ingredients; without database. */
export function pruefeZutaten(
  eingaben: readonly KiZutatEingabe[],
  listen: KiZutatListen,
  offen: ReadonlySet<string> = new Set()
): Promise<KiZutatPruefung> {
  return frage(
    {
      schemaName: 'essen_zutaten',
      schema: schema(listen),
      timeoutMs: 40_000,
      maxCompletionTokens: 8000,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(kiZutatenAnfrage(eingaben, listen, offen)) },
      ],
    },
    (raw) => leseKiZutaten(raw, eingaben, listen)
  );
}

/**
 * Checks the own ingredients of the Planung with these ids; ingredients of the central list are
 * checked in the Steuerung. Ids that are no own ingredient (any more) are left out.
 */
export async function zutatenDerPlanungPruefen(
  zugang: Zugang,
  ids: readonly number[],
  db: Db = getDb()
): Promise<KiZutatPruefung> {
  await pruefeKiZugang(zugang, db);
  const [{ zutaten }, katalog] = await Promise.all([
    ladeGerichte(db, zugang.planungId),
    ladeKatalog(db),
  ]);
  const gewaehlt = zutaten.filter((z) => z.zutatId === null && ids.includes(z.id));
  if (!gewaehlt.length) return { ergebnisse: [] };
  const offen = new Set(gewaehlt.filter((z) => z.angabenOffen).map((z) => `p${z.id}`));
  return pruefeZutaten(gewaehlt.map(kiEingabeDerPlanung), katalog, offen);
}

/** Checks central ingredients (the Steuerung); unknown ids are left out. */
export async function zentraleZutatenPruefen(
  ids: readonly number[],
  db: Db = getDb()
): Promise<KiZutatPruefung> {
  if (!isKiConfigured()) throw KI_AUS();
  const [kategorien, unvertraeglichkeiten, zutaten] = await Promise.all([
    listKategorien(db),
    listUnvertraeglichkeiten(db),
    listZutaten(db),
  ]);
  const gewaehlt = zutaten.filter((z) => ids.includes(z.id));
  if (!gewaehlt.length) return { ergebnisse: [] };
  return pruefeZutaten(gewaehlt.map(kiEingabeZentral), { kategorien, unvertraeglichkeiten });
}
