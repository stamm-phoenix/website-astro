import type { Db } from './db';
import { getDb } from './db';
import { DATEN, KI_AUS, frage, isKiConfigured } from './essen-ki';
import { leseKiDoppelte } from './essen-ki-doppelte-antwort';
import { listKategorien, listZutaten } from './essen-steuerung';
import type { KiDoppelte } from './essen-zutat-zentral-model';

/**
 * „Doppelte finden (KI)“ in the central list (`docs/essensplanung.md`, „Zentrale Zutatenliste“):
 * the AI groups ingredients that are the same thing under different names. Nothing is merged
 * here; the user merges each group after checking it.
 */

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gruppen'],
  properties: {
    gruppen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ids', 'behalten', 'grund'],
        properties: {
          ids: { type: 'array', items: { type: 'integer' } },
          behalten: { type: 'integer' },
          grund: { type: 'string' },
        },
      },
    },
  },
};

const PROMPT = `Du prüfst die zentrale Zutatenliste der Essensplanung eines Zeltlagers in Deutschland auf doppelte Einträge. Fasse in "gruppen" Zutaten zusammen, die beim Einkaufen und Kochen dasselbe sind und nur anders geschrieben oder benannt wurden (Tippfehler, Singular/Plural, Synonyme wie "Paprika rot" und "rote Paprika", "Zwiebel" und "Zwiebeln", "Schmand" und "Schmant"). Fasse nie zusammen, was verschieden gekauft oder verwendet wird (z. B. "Zucker" und "Puderzucker", "Tomaten" und "Tomaten (Dose)", "Milch" und "H-Milch", frisch und getrocknet). Jede Zutat steht in höchstens einer Gruppe, jede Gruppe hat mindestens zwei "ids". "behalten" ist die id mit dem üblichsten, klarsten Namen. "grund" ist ein kurzer deutscher Satz, warum es dieselbe Zutat ist. Gib nur sichere Fälle zurück; gibt es keine, eine leere Liste. ${DATEN}`;

/** Asks the AI about all central ingredients. */
export async function doppelteFinden(db: Db = getDb()): Promise<KiDoppelte> {
  if (!isKiConfigured()) throw KI_AUS();
  const [kategorien, zutaten] = await Promise.all([listKategorien(db), listZutaten(db)]);
  const kategorie = new Map(kategorien.map((k) => [k.id, k.name]));
  const liste = zutaten.map((z) => ({
    id: z.id,
    name: z.name,
    kategorie: kategorie.get(z.kategorieId) ?? '',
  }));
  return frage(
    {
      schemaName: 'essen_doppelte',
      schema: SCHEMA,
      timeoutMs: 40_000,
      maxCompletionTokens: 8000,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify({ zutaten: liste }) },
      ],
    },
    (raw) => leseKiDoppelte(raw, new Set(zutaten.map((z) => z.id)))
  );
}
