import type { Db } from './db';
import { getDb } from './db';
import { ladeAnsicht } from './essen-ansicht';
import type { EssenKatalog, Gericht, PlanungZutat } from './essen-gerichte-model';
import { einheitText } from './essen-gerichte-model';
import {
  BOOL_ODER_NULL,
  DATEN,
  ZAHL_ODER_NULL,
  enumOderNull,
  frage,
  ladeGericht,
  pruefeKiZugang,
} from './essen-ki';
import { KI_AKTIONEN, KI_ZEILEN_EINHEITEN, leseKiPruefung } from './essen-ki-pruefen-antwort';
import type { KiPersonenQuelle, KiPruefung } from './essen-ki-pruefen-model';
import { KI_HINWEIS_ARTEN, anwesendBeimGericht } from './essen-ki-pruefen-model';
import type { RezeptKandidat } from './essen-ki-rezept';
import { rezeptKandidaten } from './essen-ki-rezept';
import type { Zugang } from './essen-zugang';

/**
 * „Gericht prüfen (KI)“ (`docs/essensplanung.md`, „KI“): the model gets the dish with its lines,
 * tools and instructions and the people it is for, and answers with an assessment and hints, each
 * with at most one change to take over. A dish without its own number is checked for the most
 * people present at a meal it is planned at. Nothing is saved here.
 */

const STRING_ODER_NULL = { type: ['string', 'null'] };

const PRUEFEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['einschaetzung', 'hinweise'],
  properties: {
    einschaetzung: { type: 'string' },
    hinweise: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'art',
          'aktion',
          'zeile',
          'text',
          'vorschlag',
          'menge',
          'einheit',
          'fuerAlles',
          'fuerVegetarisch',
          'fuerVegan',
          'fest',
          'hinweisNeu',
          'zutatKey',
          'zutatName',
          'werkzeug',
          'werkzeugNeu',
        ],
        properties: {
          art: { type: 'string', enum: [...KI_HINWEIS_ARTEN] },
          aktion: { type: 'string', enum: [...KI_AKTIONEN] },
          zeile: { type: ['integer', 'null'] },
          text: { type: 'string' },
          vorschlag: { type: 'string' },
          menge: ZAHL_ODER_NULL,
          einheit: enumOderNull(KI_ZEILEN_EINHEITEN),
          fuerAlles: BOOL_ODER_NULL,
          fuerVegetarisch: BOOL_ODER_NULL,
          fuerVegan: BOOL_ODER_NULL,
          fest: BOOL_ODER_NULL,
          hinweisNeu: STRING_ODER_NULL,
          zutatKey: STRING_ODER_NULL,
          zutatName: STRING_ODER_NULL,
          werkzeug: STRING_ODER_NULL,
          werkzeugNeu: STRING_ODER_NULL,
        },
      },
    },
  },
};

const PRUEFEN_PROMPT = `Du prüfst ein Gericht für die Essensplanung eines Zeltlagers der Pfadfinder: ob es mit diesen Zutaten, Mengen, Werkzeugen und dieser Zubereitung für die angegebene Zahl an Essenden gelingt.

Personen: "personen" ist die Zahl der Essenden, für die du prüfst. Ist "personenQuelle" "gericht", gelten die Mengen für diese Zahl, außer bei Zeilen mit "fest" (Gesamtmenge, unabhängig von der Personenzahl). Ist sie "anwesend", hat das Gericht keine eigene Personenzahl: Alle Mengen sind Gesamtmengen, und "personen" ist die Zahl der Anwesenden bei der Mahlzeit, an der das Gericht eingeplant ist; geh davon aus, dass es genau für sie geplant ist. Ist "personen" null, sind alle Mengen Gesamtmengen und die Zahl der Essenden ist unbekannt; beurteile die Mengen dann nur im Verhältnis zueinander.

Anleitung: Ist "anleitung" null, gibt es keine. Dann bewertest du keine Zubereitung, schlägst keine vor und erwähnst auch nicht, dass eine fehlt.

Prüfe:
- Mengen: für die Zahl der Essenden plausibel (zu viel, zu wenig, vertauschte Einheit wie kg statt g), und passen sie zueinander?
- Zubereitung (nur mit Anleitung): Passen Schritte, Reihenfolge und Garzeiten zu dieser Menge, ist das in einer Lagerküche (Gaskocher, große Töpfe, wenig Platz) machbar, und nutzt die Anleitung Zutaten, die in den Zeilen fehlen, oder lässt sie Zeilen ungenutzt?
- Werkzeuge: Reichen sie für diese Menge (Größe und Zahl der Töpfe und Pfannen), und fehlt etwas, das Gericht oder Anleitung brauchen?
- Tippfehler im Namen des Gerichts, in Hinweisen und Werkzeugen.
- Passen die Häkchen "fuer" (alles, vegetarisch, vegan) zu den Merkmalen der Zutat (z. B. Fleisch nur für "alles"), und gibt es für jede Ernährungsform etwas zu essen?
- Passen "nichtFuer"/"nurFuer" zu den enthaltenen Allergenen (z. B. Weizennudeln sollten nicht für Gluten gelten)?
- Fehlt eine wichtige Zutat?

"einschaetzung" ist deine Gesamteinschätzung in zwei bis fünf deutschen Sätzen in der Du-Form, ohne Aufzählung: ob Gericht, Mengen und (nur mit Anleitung) Zubereitung für diese Zahl an Essenden so passen, und was am wichtigsten zu ändern ist.

"hinweise" sind nur echte Auffälligkeiten, höchstens 12, ohne Lob; ist alles stimmig, eine leere Liste. "art" ordnet den Hinweis ein. "zeile" ist die Nummer der betroffenen Zeile ("nr"), sonst null. "text" beschreibt das Problem in einem deutschen Satz, "vorschlag" die Lösung in einem kurzen Satz. Schreibe beide in den Worten der Oberfläche: Zutaten beim Namen statt Zeilennummern, für wen eine Zeile ist als "für alle, die alles essen", "vegetarisch" oder "vegan", Unverträglichkeiten als "nicht bei Gluten" bzw. "nur bei Gluten", dazu "feste Menge". Nenne nie Feldnamen der Daten wie fuer, nichtFuer, nurFuer, fuerAlles, fuerVegetarisch, fuerVegan, fest, nr, key oder einheitenart.

"aktion" ist die Änderung, die man mit einem Klick übernehmen kann; schlägst du nichts Konkretes vor, "keine". Felder, die nicht zur Aktion gehören, sind null.
- "zeile_aendern" (mit "zeile"): eine neue Menge in "menge" und "einheit" (bleib bei der Einheit der Zeile), andere Häkchen in "fuerAlles", "fuerVegetarisch", "fuerVegan", ein neuer Hinweis der Zeile in "hinweisNeu" (höchstens 100 Zeichen), eine andere Zutat für die Zeile in "zutatKey" (Schlüssel aus "liste") oder, wenn keine der Liste passt, in "zutatName". Was gleich bleibt, ist null.
- "zeile_entfernen" (mit "zeile"): Die Zeile gehört nicht ins Gericht oder steht doppelt da.
- "zutat_hinzufuegen": eine fehlende Zutat. "zutatKey" ist ihr Schlüssel aus "liste", sonst null und "zutatName" ihr Name. "menge" und "einheit" in der Einheitenart der Zutat für die Zahl der Essenden, beide null für "nach Gefühl". "fest" ist true, wenn die Menge nicht mit der Personenzahl wachsen soll. "fuerAlles", "fuerVegetarisch", "fuerVegan" sagen, für wen die Zeile ist; "hinweisNeu" ist ein kurzer Hinweis oder null.
- "werkzeug_hinzufuegen": "werkzeugNeu" ist das fehlende Werkzeug, z. B. "Topf 30 l".
- "werkzeug_aendern": "werkzeug" ist ein Werkzeug aus "werkzeuge", wörtlich, und "werkzeugNeu" seine neue Bezeichnung, z. B. ein größerer Topf.
- "werkzeug_entfernen": "werkzeug" aus "werkzeuge", wörtlich, wird nicht gebraucht.
Einheiten sind g, kg, ml, l, stueck, packung oder bund. Die Anleitung änderst du nie selbst; Vorschläge zur Zubereitung stehen nur in "text" und "vorschlag". ${DATEN}`;

/** Addresses and phone numbers someone may have written into the instructions. */
const MAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const TELEFON = /(?:\+|\b0)\d[\d /-]{5,}\d/g;

/** The instructions as the model sees them: without addresses and phone numbers; null for none. */
export function anleitungFuerModell(anleitung: string): string | null {
  const text = anleitung.replace(MAIL, '[E-Mail]').replace(TELEFON, '[Telefon]').trim();
  return text || null;
}

/** The dish as the model sees it: names, amounts, tools, instructions; never its notes. */
function gerichtFuerModell(
  gericht: Gericht,
  zutaten: ReadonlyMap<number, PlanungZutat>,
  katalog: EssenKatalog,
  kandidaten: readonly RezeptKandidat[],
  anwesend: number | null
) {
  const unvertraeglichkeit = new Map(katalog.unvertraeglichkeiten.map((u) => [u.id, u.name]));
  const namen = (ids: number[]) => ids.map((id) => unvertraeglichkeit.get(id) ?? '?');
  const quelle: KiPersonenQuelle | null =
    gericht.personen !== null ? 'gericht' : anwesend !== null ? 'anwesend' : null;
  return {
    gericht: gericht.name,
    personen: gericht.personen ?? anwesend,
    personenQuelle: quelle,
    zeilen: gericht.zutaten.map((zeile, index) => {
      const zutat = zutaten.get(zeile.planungZutatId);
      return {
        nr: index + 1,
        zutat: zutat?.name ?? '?',
        einheitenart: zutat?.einheitenart ?? null,
        menge: zeile.menge,
        einheit: zeile.einheit ? einheitText(zeile.einheit) : null,
        // Without people every amount of the dish is a fixed total
        fest: zeile.fest || gericht.personen === null,
        fuer: [
          ...(zeile.fuerAlles ? ['alles'] : []),
          ...(zeile.fuerVegetarisch ? ['vegetarisch'] : []),
          ...(zeile.fuerVegan ? ['vegan'] : []),
        ],
        nichtFuer: namen(zeile.ohne),
        nurFuer: namen(zeile.nur),
        hinweis: zeile.hinweis,
        merkmale: {
          vegetarisch: zutat?.vegetarisch ?? null,
          vegan: zutat?.vegan ?? null,
          enthaelt: namen(zutat?.allergene ?? []),
        },
      };
    }),
    werkzeuge: gericht.werkzeuge,
    anleitung: anleitungFuerModell(gericht.anleitung),
    liste: kandidaten.map((kandidat) => ({
      key: kandidat.key,
      name: kandidat.name,
      einheitenart: kandidat.einheitenart,
    })),
  };
}

/**
 * An assessment of a dish and hints, each with a proposal; some change the dish with one click.
 * A dish without its own number is checked for the people present where it is planned.
 */
export async function gerichtPruefen(
  zugang: Zugang,
  gerichtId: number,
  db: Db = getDb()
): Promise<KiPruefung> {
  await pruefeKiZugang(zugang, db);
  const { gericht, zutaten, katalog } = await ladeGericht(zugang, gerichtId, db);
  const anwesend =
    gericht.personen === null
      ? anwesendBeimGericht(await ladeAnsicht(zugang, db), gericht.id)
      : null;
  return pruefeGericht(gericht, zutaten, katalog, anwesend);
}

/** The check itself, without database; `anwesend` counts only for a dish without people. */
export function pruefeGericht(
  gericht: Gericht,
  zutatenListe: readonly PlanungZutat[],
  katalog: EssenKatalog,
  anwesend: number | null = null
): Promise<KiPruefung> {
  const zutaten = new Map(zutatenListe.map((zutat) => [zutat.id, zutat]));
  const kandidaten = rezeptKandidaten(katalog, zutatenListe);
  const daten = gerichtFuerModell(gericht, zutaten, katalog, kandidaten, anwesend);
  return frage(
    {
      schemaName: 'essen_gericht_pruefen',
      schema: PRUEFEN_SCHEMA,
      timeoutMs: 40_000,
      maxCompletionTokens: 8000,
      messages: [
        { role: 'system', content: PRUEFEN_PROMPT },
        { role: 'user', content: JSON.stringify(daten) },
      ],
    },
    (raw) =>
      leseKiPruefung(raw, gericht, zutaten, {
        kandidaten,
        geprueftFuer: daten.personen,
        personenQuelle: daten.personenQuelle,
      })
  );
}
