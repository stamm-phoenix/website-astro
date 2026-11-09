import { z } from 'zod';
import {
  mailboxPath,
  NachrichtGeaendertError,
  postfachGraph,
  PostfachSchreibError,
} from './postfach-graph-basis';
import { getGraphStatus } from './sharepoint-data-access';
import type { NachrichtAenderung } from './postfach-aenderung';

/**
 * Writes the status and the responsible person of a conversation into Outlook: the flags and
 * categories of its messages (`postfach-aenderung.ts`). Needs `Mail.ReadWrite` on the mailbox;
 * nothing else of the mailbox is changed, nothing moved or deleted.
 */

/** Messages changed at the same time. */
const GLEICHZEITIG = 4;

function body(aenderung: NachrichtAenderung, jetzt: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (aenderung.flag === 'complete') {
    patch.flag = {
      flagStatus: 'complete',
      completedDateTime: { dateTime: jetzt.replace(/Z$/, ''), timeZone: 'UTC' },
    };
  } else if (aenderung.flag) {
    patch.flag = { flagStatus: aenderung.flag };
  }
  if (aenderung.kategorien) patch.categories = aenderung.kategorien;
  return patch;
}

/**
 * Sends the changes, a few at a time. A message deleted meanwhile is skipped; when Graph refuses
 * the change, `PostfachSchreibError`; when a message changed since it was read (e.g. in
 * Outlook), `NachrichtGeaendertError`. After a failure the requests already on their way finish
 * first, so the caller knows nothing is still changing; what was sent stays changed.
 */
export async function schreibeAenderungen(
  address: string,
  aenderungen: readonly NachrichtAenderung[],
  now: Date = new Date()
): Promise<void> {
  const jetzt = now.toISOString();
  for (let start = 0; start < aenderungen.length; start += GLEICHZEITIG) {
    const ergebnisse = await Promise.allSettled(
      aenderungen.slice(start, start + GLEICHZEITIG).map(async (aenderung) => {
        try {
          await postfachGraph.patch(
            `${mailboxPath(address)}/messages/${encodeURIComponent(aenderung.id)}`,
            body(aenderung, jetzt),
            aenderung.etag
          );
        } catch (error: unknown) {
          const status = getGraphStatus(error);
          if (status === 404) return;
          if (status === 401 || status === 403) throw new PostfachSchreibError(address);
          if (status === 409 || status === 412) throw new NachrichtGeaendertError();
          throw error;
        }
      })
    );
    const fehler = ergebnisse.find(
      (ergebnis): ergebnis is PromiseRejectedResult => ergebnis.status === 'rejected'
    );
    if (fehler) throw fehler.reason;
  }
}

const masterSchema = z.object({
  value: z.array(z.object({ displayName: z.string() }).catch({ displayName: '' })),
});

/** Categories known to exist in the mailbox's list, so they are not asked for every time. */
const bekannt = new Map<string, Set<string>>();

/** For the tests. */
export function resetKategorienCache(): void {
  bekannt.clear();
}

/** One of Outlook's preset colours, the same for a name every time. */
function farbe(name: string): string {
  let summe = 0;
  for (const zeichen of name) summe = (summe * 31 + (zeichen.codePointAt(0) ?? 0)) % 25;
  return `preset${summe}`;
}

/**
 * Puts the category into the mailbox's list of categories, so Outlook shows it in a colour and
 * offers it in the menu. Optional: a category on a message works without it, so a refusal
 * (missing `MailboxSettings.ReadWrite`) only returns false.
 */
export async function kategorieAnlegen(address: string, name: string): Promise<boolean> {
  const liste = bekannt.get(address);
  if (liste?.has(name.toLowerCase())) return true;
  try {
    const path = `${mailboxPath(address)}/outlook/masterCategories`;
    const parsed = masterSchema.safeParse(await postfachGraph.get(path, {}, []));
    const namen = new Set(
      (parsed.success ? parsed.data.value : []).map((entry) => entry.displayName.toLowerCase())
    );
    if (!namen.has(name.toLowerCase())) {
      await postfachGraph.post(path, { displayName: name, color: farbe(name) });
      namen.add(name.toLowerCase());
    }
    bekannt.set(address, namen);
    return true;
  } catch {
    return false;
  }
}
