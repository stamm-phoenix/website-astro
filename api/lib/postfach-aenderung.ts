import {
  ZUSTAENDIG_PRAEFIX,
  type InboxNachricht,
  type OutlookFlag,
  type PostfachStatus,
} from './postfach-model';

/**
 * What the module „E-Mail“ writes into Outlook to set the status or the responsible person of a
 * conversation (`docs/postfaecher.md`). Pure rules; `postfach-schreiben.ts` sends them.
 *
 * - „Neu“: no message of the conversation has a flag.
 * - „Handlungsbedarf“: the newest message has a flag, the others none, so completing that one
 *   flag in Outlook completes the conversation.
 * - „Erledigt“: every message has a completed flag.
 * - The responsible person is a category on every received message; other categories stay.
 */

export type NachrichtStand = Pick<InboxNachricht, 'id' | 'am' | 'flag' | 'kategorien' | 'etag'>;

/** The change of one message; only what differs from now is sent. */
export interface NachrichtAenderung {
  id: string;
  /** The version that was read; the change is refused when the message changed since. */
  etag?: string;
  flag?: OutlookFlag;
  kategorien?: string[];
}

function neuesteId(nachrichten: readonly NachrichtStand[]): string | null {
  let neueste: NachrichtStand | null = null;
  for (const nachricht of nachrichten)
    if (!neueste || nachricht.am > neueste.am) neueste = nachricht;
  return neueste?.id ?? null;
}

/** The flag each message gets for the status. */
export function flagsFuer(
  nachrichten: readonly NachrichtStand[],
  status: PostfachStatus
): Map<string, OutlookFlag> {
  const neueste = neuesteId(nachrichten);
  return new Map(
    nachrichten.map((nachricht): [string, OutlookFlag] => [
      nachricht.id,
      status === 'erledigt'
        ? 'complete'
        : status === 'handlungsbedarf' && nachricht.id === neueste
          ? 'flagged'
          : 'notFlagged',
    ])
  );
}

/** The categories of a message with `kategorie` as the only person (null: nobody). */
export function kategorienMit(kategorien: readonly string[], kategorie: string | null): string[] {
  const andere = kategorien.filter((entry) => !entry.startsWith(ZUSTAENDIG_PRAEFIX));
  return kategorie ? [...andere, kategorie] : andere;
}

function gleich(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/**
 * The changes for the messages of a conversation: the new status (undefined: as it is) and the
 * category of the person (undefined: as it is, null: nobody). Messages that already fit are left
 * out.
 */
export function aenderungen(
  nachrichten: readonly NachrichtStand[],
  ziel: { status?: PostfachStatus; kategorie?: string | null }
): NachrichtAenderung[] {
  const flags = ziel.status ? flagsFuer(nachrichten, ziel.status) : null;
  return nachrichten.flatMap((nachricht) => {
    const aenderung: NachrichtAenderung = {
      id: nachricht.id,
      ...(nachricht.etag && { etag: nachricht.etag }),
    };
    const flag = flags?.get(nachricht.id);
    if (flag && flag !== nachricht.flag) aenderung.flag = flag;
    if (ziel.kategorie !== undefined) {
      const kategorien = kategorienMit(nachricht.kategorien, ziel.kategorie);
      if (!gleich(kategorien, nachricht.kategorien)) aenderung.kategorien = kategorien;
    }
    return aenderung.flag || aenderung.kategorien ? [aenderung] : [];
  });
}

/** The messages as they are after the changes, to answer with the new state without reading. */
export function nachAenderung<T extends NachrichtStand & Pick<InboxNachricht, 'erledigtAm'>>(
  nachrichten: readonly T[],
  geaendert: readonly NachrichtAenderung[],
  now: Date = new Date()
): T[] {
  const byId = new Map(geaendert.map((aenderung) => [aenderung.id, aenderung]));
  return nachrichten.map((nachricht) => {
    const aenderung = byId.get(nachricht.id);
    if (!aenderung) return nachricht;
    return {
      ...nachricht,
      ...(aenderung.flag && {
        flag: aenderung.flag,
        erledigtAm: aenderung.flag === 'complete' ? now.toISOString() : null,
      }),
      ...(aenderung.kategorien && { kategorien: aenderung.kategorien }),
    };
  });
}
