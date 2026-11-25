import type { Db } from './db';
import { getDb } from './db';
import { aendere } from './essen-aendern';
import { ladeAnsicht } from './essen-ansicht';
import { setzeAllergene } from './essen-gerichte';
import { einheitText } from './essen-gerichte-model';
import { DATEN, frage, pruefeKiZugang } from './essen-ki';
import type { KiZutatAngaben } from './essen-ki-zutaten-antwort';
import {
  KI_EINHEITENARTEN,
  KI_ERNAEHRUNG,
  kiZutatSchluessel,
  leseKiZutaten,
} from './essen-ki-zutaten-antwort';
import type { PlanungAnsicht } from './essen-planung-model';
import { listKategorien, listUnvertraeglichkeiten } from './essen-steuerung';
import { angabenListe } from './essen-zutat-angaben';
import type { Zugang } from './essen-zugang';

/**
 * „Zutaten schnell anlegen“ (`docs/essensplanung.md`): an ingredient added by its name alone gets
 * stand-ins for its category and kind of unit and no diet. The page then asks here, and the AI
 * fills in what is still open for all such ingredients of the Planung at once. What it fills in
 * stays marked as unchecked until someone saves the ingredient.
 */

/** Ingredients per question; more wait for the next one. */
const MAX_JE_FRAGE = 25;

const ZUTATEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['zutaten'],
  properties: {
    zutaten: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['schluessel', 'kategorie', 'einheitenart', 'ernaehrung', 'allergene'],
        properties: {
          schluessel: { type: 'string' },
          kategorie: { type: ['integer', 'null'] },
          einheitenart: { anyOf: [{ type: 'string', enum: KI_EINHEITENARTEN }, { type: 'null' }] },
          ernaehrung: { anyOf: [{ type: 'string', enum: KI_ERNAEHRUNG }, { type: 'null' }] },
          allergene: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
};

const ZUTATEN_PROMPT = `Du ergänzt die Angaben zu Zutaten in der Essensplanung eines Zeltlagers, die jemand nur mit ihrem Namen angelegt hat. Gib für jede Zutat genau einen Eintrag mit ihrem "schluessel" zurück. "kategorie" ist die id der passenden Kategorie aus "kategorien" (wie man im Großmarkt sortiert), sonst null. "einheitenart" sagt, worin man die Zutat üblicherweise abmisst und einkauft: masse (g/kg) für Mehl, Fleisch, Käse, Gemüse nach Gewicht; volumen (ml/l) für Flüssiges; stueck für Eier, Brötchen, Paprika; packung für Fertigware wie Blätterteig oder Tortellini; bund für Kräuter und Frühlingszwiebeln. "einheiten" nennt die Einheiten, in denen sie schon eingetragen ist; die passen meist. "ernaehrung" ist vegan, vegetarisch (ohne Fleisch und Fisch, aber mit Milch, Ei oder Honig) oder fleisch (enthält Fleisch, Fisch oder Gelatine); null nur, wenn der Name dafür nicht reicht. "allergene" sind die ids aus "unvertraeglichkeiten", die die Zutat üblicherweise enthält, auch Spuren nicht; leer, wenn keine. ${DATEN}`;

interface OffeneZutat {
  id: number;
  version: Buffer;
  name: string;
  angaben_offen: string | null;
}

/** The ingredients of the Planung whose details are open, oldest first. */
async function offeneZutaten(db: Db, zugang: Zugang): Promise<OffeneZutat[]> {
  const rows = await db
    .selectFrom('essen.planung_zutat')
    .select(['id', 'version', 'name', 'angaben_offen'])
    .where('planung_id', '=', zugang.planungId)
    .where('zutat_id', 'is', null)
    .where('angaben_offen', 'is not', null)
    .orderBy('id')
    .limit(MAX_JE_FRAGE)
    .execute();
  return rows.map((row) => ({ ...row, version: row.version as Buffer, name: row.name ?? '' }));
}

/** The units each ingredient is entered in already, a hint for its kind of unit. */
async function einheitenJeZutat(db: Db, ids: number[]): Promise<Map<number, string[]>> {
  const rows = await db
    .selectFrom('essen.gericht_zutat')
    .select(['planung_zutat_id', 'einheit'])
    .distinct()
    .where('planung_zutat_id', 'in', ids)
    .where('einheit', 'is not', null)
    .execute();
  const map = new Map<number, string[]>();
  for (const row of rows) {
    map.set(row.planung_zutat_id, [
      ...(map.get(row.planung_zutat_id) ?? []),
      einheitText(row.einheit!),
    ]);
  }
  return map;
}

/** Saves what is still open of each ingredient; one changed meanwhile keeps its values. */
async function speichere(
  zugang: Zugang,
  zutaten: readonly OffeneZutat[],
  angaben: readonly KiZutatAngaben[]
): Promise<string[]> {
  return aendere(zugang, 'zutat-ki', async (trx) => {
    const namen: string[] = [];
    for (const zutat of zutaten) {
      const ki = angaben.find((eintrag) => eintrag.planungZutatId === zutat.id);
      const offen = angabenListe(zutat.angaben_offen);
      const merkmale = ki && offen.includes('merkmale') && ki.vegetarisch !== null;
      const result = await trx
        .updateTable('essen.planung_zutat')
        .set({
          ...(ki?.kategorieId && offen.includes('kategorie')
            ? { kategorie_id: ki.kategorieId }
            : {}),
          ...(ki?.einheitenart && offen.includes('einheitenart')
            ? { einheitenart: ki.einheitenart }
            : {}),
          ...(merkmale ? { vegetarisch: ki.vegetarisch, vegan: ki.vegan } : {}),
          // Asked once: what the AI did not know stays a stand-in for the member to fill in
          angaben_offen: null,
        })
        .where('id', '=', zutat.id)
        .where('version', '=', zutat.version)
        .where('angaben_offen', 'is not', null)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) continue;
      if (merkmale) await setzeAllergene(trx, zutat.id, ki.allergene ?? []);
      namen.push(zutat.name);
    }
    return { result: namen, details: { namen } };
  });
}

/**
 * Lets the AI fill in the open details of the Planung's ingredients added by name alone.
 * Answers the new view and the names of the ingredients it filled in (none: nothing was open).
 */
export async function zutatenErgaenzen(
  zugang: Zugang,
  db: Db = getDb()
): Promise<{ ansicht: PlanungAnsicht; ergaenzt: string[] }> {
  await pruefeKiZugang(zugang, db);
  const zutaten = await offeneZutaten(db, zugang);
  if (!zutaten.length) return { ansicht: await ladeAnsicht(zugang, db), ergaenzt: [] };
  const [einheiten, kategorien, unvertraeglichkeiten] = await Promise.all([
    einheitenJeZutat(
      db,
      zutaten.map((zutat) => zutat.id)
    ),
    listKategorien(db),
    listUnvertraeglichkeiten(db),
  ]);
  const ids = zutaten.map((zutat) => zutat.id);
  const angaben = await frage(
    {
      schemaName: 'essen_zutaten',
      schema: ZUTATEN_SCHEMA,
      timeoutMs: 30_000,
      maxCompletionTokens: 4000,
      messages: [
        { role: 'system', content: ZUTATEN_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            kategorien: kategorien.map((k) => ({ id: k.id, name: k.name })),
            unvertraeglichkeiten: unvertraeglichkeiten.map((u) => ({ id: u.id, name: u.name })),
            zutaten: zutaten.map((zutat) => ({
              schluessel: kiZutatSchluessel(zutat.id),
              name: zutat.name,
              einheiten: einheiten.get(zutat.id) ?? [],
            })),
          }),
        },
      ],
    },
    (raw) => leseKiZutaten(raw, ids, { kategorien, unvertraeglichkeiten })
  );
  const ergaenzt = await speichere(zugang, zutaten, angaben);
  return { ansicht: await ladeAnsicht(zugang, db), ergaenzt };
}
