import type { Db } from './db';
import { RecordNotFoundError, parseId } from './db';

/** Logs a change of the Steuerung in `essen.audit_log`. */
export async function audit(
  db: Db,
  actor: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await db
    .insertInto('essen.audit_log')
    .values({ actor, action, details: JSON.stringify(details) })
    .execute();
}

/** The id of a route parameter; anything that is no id is a missing record. */
export function readRouteId(id: string): number {
  const numeric = parseId(id);
  if (numeric === undefined) throw new RecordNotFoundError();
  return numeric;
}
