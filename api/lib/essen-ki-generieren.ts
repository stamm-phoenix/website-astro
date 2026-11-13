import type { Db } from './db';
import { getDb } from './db';
import type { EssenKatalog, PlanungZutat } from './essen-gerichte-model';
import { DATEN, REZEPT_SCHEMA, frage, ladeGericht, pruefeKiZugang } from './essen-ki';
import { leseKiGericht } from './essen-ki-gericht';
import type { KiGericht } from './essen-ki-model';
import { rezeptKandidaten } from './essen-ki-rezept';
import type { Zugang } from './essen-zugang';

/**
 * „Gericht generieren lassen (KI)“ (`docs/essensplanung.md`, „KI“): the AI writes a whole dish
 * from a short description, with the people it is for, the ingredients (mapped onto the lists
 * like a pasted recipe), instructions and tools. The model gets the description, the name and
 * people of the dish and the list of food, never the instructions or note of the dish nor names
 * of members. Nothing is saved: the page shows the dish to confirm first.
 */

const GENERIEREN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rezeptPersonen', 'zeilen', 'anleitung', 'werkzeuge'],
  properties: {
    ...REZEPT_SCHEMA.properties,
    anleitung: { type: 'string' },
    werkzeuge: { type: 'array', items: { type: 'string' } },
  },
};

const GENERIEREN_PROMPT = `Du schreibst ein Rezept für die Essensplanung eines Zeltlagers der Pfadfinder, gekocht von Ehrenamtlichen in einer Lagerküche (Gaskocher, große Töpfe, wenig Kühlung). Grundlage ist die Beschreibung in "beschreibung" und der Name in "gericht"; die Beschreibung kann Wünsche zu Ernährung, Personenzahl oder Zutaten enthalten. Ist "personen" eine Zahl, schreibe das Rezept genau für so viele Personen und setze "rezeptPersonen" auf diese Zahl; ist es null, nimm die Personenzahl aus der Beschreibung, sonst 10, und setze "rezeptPersonen" darauf. Plane Mengen für hungrige Jugendliche.
"zeilen" sind die Zutaten, höchstens 40, in der Reihenfolge der Zubereitung; kein Wasser aus der Leitung, keine Geräte. Nimm wo möglich Zutaten aus "liste" und setze "key" auf deren Schlüssel; nur wenn keine passt, eine übliche Zutat mit "key" null. "name" ist der Name der Zutat (bei einer aus der Liste genau dieser Name), "original" die Zeile, wie sie in einem Rezept stünde (z. B. "2 kg Nudeln"). Nimm bevorzugt die Einheit der Zutat ("einheitenart": masse = g oder kg, volumen = ml oder l, stueck, packung, bund); "einheit" ist eine von g, kg, ml, l, stueck, packung, bund, tl, el, prise, "menge" eine Zahl dazu. Gewürze nach Geschmack ohne Menge: "menge" und "einheit" null. "einheitRezept" ist das Wort der Einheit in der Einzahl (z. B. "kg", "EL", "Dose"); "inhaltMenge" und "inhaltEinheit" setzt du nur, wenn eine Dose oder Packung mit Inhalt gemeint ist (z. B. 400 und g), sonst null. "hinweis" ist eine kurze Ergänzung wie "gewürfelt", sonst leer.
"anleitung" ist die Zubereitung auf Deutsch in Markdown: eine nummerierte Liste kurzer Schritte, mit Hinweisen für große Mengen, ohne Überschrift und ohne Zutatenliste. "werkzeuge" sind die benötigten Küchengeräte, höchstens 15, jeweils kurz (z. B. "Großer Topf", "Pürierstab"); Selbstverständliches wie Messer oder Löffel nur, wenn es besonders ist. ${DATEN}`;

/** A dish written from `beschreibung`, for the people of the dish; not saved yet. */
export async function gerichtGenerieren(
  zugang: Zugang,
  gerichtId: number,
  beschreibung: string,
  db: Db = getDb()
): Promise<KiGericht> {
  await pruefeKiZugang(zugang, db);
  const { gericht, zutaten, katalog } = await ladeGericht(zugang, gerichtId, db);
  return generiereGericht(beschreibung, gericht, zutaten, katalog);
}

/** Writing the dish itself, without database. */
export function generiereGericht(
  beschreibung: string,
  gericht: { name: string; personen: number | null },
  zutaten: readonly PlanungZutat[],
  katalog: EssenKatalog
): Promise<KiGericht> {
  const kandidaten = rezeptKandidaten(katalog, zutaten);
  return frage(
    {
      schemaName: 'essen_gericht_generieren',
      schema: GENERIEREN_SCHEMA,
      // Below the 45 s the Static Web App waits for an answer, so a late one is not lost
      timeoutMs: 40_000,
      maxCompletionTokens: 10_000,
      messages: [
        { role: 'system', content: GENERIEREN_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            gericht: gericht.name,
            personen: gericht.personen,
            beschreibung,
            liste: kandidaten.map((kandidat) => ({
              key: kandidat.key,
              name: kandidat.name,
              einheitenart: kandidat.einheitenart,
            })),
          }),
        },
      ],
    },
    (raw) => leseKiGericht(raw, kandidaten, gericht.personen)
  );
}
