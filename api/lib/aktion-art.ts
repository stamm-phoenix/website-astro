import { getAktionenOhneZuschuss } from './aktion-zuschuss';
import { getDb, getSqlErrorNumber } from './db';

/**
 * Whether a CampFlow event is a real Aktion (`organisation.aktion_keine_aktion`, migration
 * `0033_aktion_keine_aktion.sql`). Every event is one unless it is listed there: entries that
 * only use the registration and payment of CampFlow, such as orders of jumpers and neckerchiefs.
 * Such an event is left out of the public calendar and of every choice of Aktionen, never gets
 * the KJR grant and is listed apart in the Abrechnung. Endpoints attach both marks with
 * `withAktionArt` or `getAktionArt`, so no module filters on its own.
 */

const DUPLICATE_KEY = 2627;

/** The marks of a CampFlow event as the Leitendenbereich sees them. */
export interface AktionArt {
  /** Whether the KJR grant is applied for; never for an event that is no Aktion. */
  zuschussfaehig: boolean;
  /** Whether the event is no real Aktion, e.g. an order of jumpers. */
  keineAktion: boolean;
}

/** IDs of the CampFlow events that are no real Aktion. */
export async function getKeineAktionen(): Promise<Set<string>> {
  const rows = await getDb()
    .selectFrom('organisation.aktion_keine_aktion')
    .select('campflow_id')
    .execute();
  return new Set(rows.map((row) => row.campflow_id));
}

/** Marks a CampFlow event as no real Aktion or takes the mark back; the same value changes nothing. */
export async function setKeineAktion(
  campflowId: string,
  keineAktion: boolean,
  actor: string
): Promise<void> {
  if (!keineAktion) {
    await getDb()
      .deleteFrom('organisation.aktion_keine_aktion')
      .where('campflow_id', '=', campflowId)
      .execute();
    return;
  }
  try {
    await getDb()
      .insertInto('organisation.aktion_keine_aktion')
      .values({ campflow_id: campflowId, created_by: actor })
      .execute();
  } catch (error: unknown) {
    // Someone else marked it at the same time
    if (getSqlErrorNumber(error) !== DUPLICATE_KEY) throw error;
  }
}

/** The CampFlow events with their marks. */
export async function withAktionArt<T extends { id: string }>(
  events: T[]
): Promise<(T & AktionArt)[]> {
  const [ohneZuschuss, keineAktionen] = await Promise.all([
    getAktionenOhneZuschuss(),
    getKeineAktionen(),
  ]);
  return events.map((event) => {
    const keineAktion = keineAktionen.has(event.id);
    return { ...event, keineAktion, zuschussfaehig: !keineAktion && !ohneZuschuss.has(event.id) };
  });
}

/** The marks of the CampFlow event `campflowId`. */
export async function getAktionArt(campflowId: string): Promise<AktionArt> {
  const [{ zuschussfaehig, keineAktion }] = await withAktionArt([{ id: campflowId }]);
  return { zuschussfaehig, keineAktion };
}
