import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { getDb } from './db';
import type { PlanungZugang } from './essen-planung-model';
import { leitungMitglied } from './essen-leitung';

/** Access to a Planung by link: the errors of a link, the tokens and what a token gives. */

/** A request the link does not allow, or a rule of the Planung; the endpoint answers with it. */
export class PlanungError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'PlanungError';
  }
}

export const LINK_UNGUELTIG = () =>
  new PlanungError(
    404,
    'LINK_UNGUELTIG',
    'Dieser Link gilt nicht (mehr). Vielleicht wurde er durch einen neuen ersetzt oder der Zugang entzogen. Neue Links bekommst du auf der Seite „Essensplanung“ unter „Meine Planungen“.'
  );

export const NUR_LESEN = () =>
  new PlanungError(403, 'NUR_LESEN', 'Mit diesem Link kannst du die Planung nur ansehen.');

export const NICHT_ERLAUBT = () =>
  new PlanungError(
    403,
    'NICHT_ERLAUBT',
    'Das dürfen nur die Besitzer:innen der Planung (oder, wenn sie es erlauben, alle Bearbeitenden).'
  );

export const WARTUNG = () =>
  new PlanungError(
    503,
    'MAINTENANCE',
    'Die Essensplanung wird gerade gewartet. Ansehen geht, Änderungen bitte etwas später noch einmal.'
  );

/** 32 random bytes, base64url: the secret part of every link. */
export function neuesToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whether a string can be a token at all; anything else never reaches the database. */
export function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export interface Zugang {
  planungId: number;
  zugang: PlanungZugang;
  mitgliedId: number | null;
  name: string;
}

/**
 * The access a token gives: a member's own link (from a mail or, for Leitende, from the
 * Leitendenbereich), or the shared read-only link.
 */
export async function ladeZugang(token: unknown, db: Db = getDb()): Promise<Zugang> {
  if (!isToken(token)) throw LINK_UNGUELTIG();
  const mitglied = await db
    .selectFrom('essen.mitglied')
    .select(['id', 'planung_id', 'rolle', 'name'])
    .where('token_hash', '=', hashToken(token))
    .where('entzogen_am', 'is', null)
    .executeTakeFirst()
    // The member's token for the Leitendenbereich gives the same access
    .then((row) => row ?? leitungMitglied(db, token));
  if (mitglied) {
    return {
      planungId: mitglied.planung_id,
      zugang: mitglied.rolle,
      mitgliedId: mitglied.id,
      name: mitglied.name,
    };
  }
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('lese_token', '=', token)
    .executeTakeFirst();
  if (planung) return { planungId: planung.id, zugang: 'lesen', mitgliedId: null, name: '' };
  throw LINK_UNGUELTIG();
}
