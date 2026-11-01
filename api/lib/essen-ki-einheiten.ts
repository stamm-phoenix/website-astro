import type { Db } from './db';
import { RecordNotFoundError, getDb } from './db';
import type { EinheitenVorkommen, KiEinheiten } from './essen-einheiten-model';
import { einheitenVorkommen, vorkommendeEinheiten } from './essen-einheiten-model';
import { einheitText } from './essen-gerichte-model';
import { DATEN, frage, pruefeKiZugang } from './essen-ki';
import { leseKiEinheiten } from './essen-ki-einheiten-antwort';
import type { Zugang } from './essen-planung';
import { PlanungError, ladeAnsicht } from './essen-planung';
import type { EssenEinheitenart } from './essen-validation';

/**
 * „Einheiten vereinheitlichen“ (`docs/essensplanung.md`, „Einheiten“): the AI proposes one unit
 * in household amounts for an ingredient measured in different units, and a factor per unit.
 * Nothing is saved here; the page shows the result and saves what the member confirms.
 */

const EINHEITEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ziel', 'begruendung', 'faktoren'],
  properties: {
    ziel: { type: 'string' },
    begruendung: { type: 'string' },
    faktoren: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['einheit', 'faktor'],
        properties: { einheit: { type: 'string' }, faktor: { type: ['number', 'null'] } },
      },
    },
  },
};

const EINHEITEN_PROMPT = `Eine Zutat steht in der Essensplanung eines Zeltlagers in verschiedenen Einheiten. Schlage eine gemeinsame Einheit vor, in der eine Küche diese Zutat üblicherweise abmisst und einkauft, also in Haushaltsmengen: Kräuter in Bund, Gewürze in g oder TL, Flüssiges in ml oder l, Gemüse und Obst in Stück oder kg, Dosenware in Dose; nie Kräuter oder Gewürze in kg. Nimm bevorzugt eine der vorkommenden Einheiten. "ziel" ist diese Einheit, kurz geschrieben wie "g", "kg", "ml", "l", "Stück", "Packung", "Bund", "Dose", "EL" oder "TL". "faktoren" enthält für jede vorkommende Einheit genau einen Eintrag: "einheit" wie in "einheiten", "faktor" ist, wie viele "ziel" eine dieser Einheit sind (z. B. 1 Bund Petersilie = 20 g, also bei ziel "g" faktor 20; bei ziel "Bund" ist 1 g = 0.05). Weißt du es nicht, faktor null. "begruendung" ist ein kurzer deutscher Satz, worauf die Wahl und die Umrechnung beruhen. ${DATEN}`;

/** The data the model sees: the ingredient and its amounts with where they are, no people. */
function anfrage(
  name: string,
  einheitenart: EssenEinheitenart,
  vorkommen: readonly EinheitenVorkommen[]
) {
  return {
    zutat: name,
    einheitenart,
    einheiten: vorkommendeEinheiten(vorkommen).map((einheit) => einheitText(einheit)),
    mengen: vorkommen.slice(0, 60).map((eintrag) => ({
      menge: eintrag.menge,
      einheit: einheitText(eintrag.einheit),
      wo: eintrag.wo,
      personen: eintrag.personen,
    })),
  };
}

/** The proposal itself, without database. */
export function schlageEinheitenVor(
  planungZutatId: number,
  name: string,
  einheitenart: EssenEinheitenart,
  vorkommen: readonly EinheitenVorkommen[]
): Promise<KiEinheiten> {
  return frage(
    {
      schemaName: 'essen_einheiten',
      schema: EINHEITEN_SCHEMA,
      timeoutMs: 30_000,
      maxCompletionTokens: 3000,
      messages: [
        { role: 'system', content: EINHEITEN_PROMPT },
        { role: 'user', content: JSON.stringify(anfrage(name, einheitenart, vorkommen)) },
      ],
    },
    (raw) => leseKiEinheiten(raw, planungZutatId, vorkommen)
  );
}

/** A common unit and factors for the amounts of one ingredient of the Planung. */
export async function einheitenVorschlagen(
  zugang: Zugang,
  planungZutatId: number,
  db: Db = getDb()
): Promise<KiEinheiten> {
  await pruefeKiZugang(zugang, db);
  // The whole view: what was cooked and bought counts too
  const ansicht = await ladeAnsicht(zugang, db);
  const zutat = ansicht.zutaten.find((eintrag) => eintrag.id === planungZutatId);
  if (!zutat) throw new RecordNotFoundError();
  const vorkommen = einheitenVorkommen(ansicht, planungZutatId);
  if (vorkommendeEinheiten(vorkommen).length < 2)
    throw new PlanungError(
      400,
      'INVALID',
      `${zutat.name} steht schon in einer Einheit. Lade die Seite neu, wenn du etwas anderes siehst.`
    );
  return schlageEinheitenVor(planungZutatId, zutat.name, zutat.einheitenart, vorkommen);
}
