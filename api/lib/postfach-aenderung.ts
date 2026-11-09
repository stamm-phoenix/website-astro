import {
  ZUSTAENDIG_PRAEFIX,
  type InboxNachricht,
  type MailOrdner,
  type OutlookFlag,
  type PostfachStatus,
} from './postfach-model';

/**
 * What the module „E-Mail“ writes into Outlook to set the status or the responsible person of a
 * conversation (`docs/postfaecher.md`). Pure rules; `postfach-schreiben.ts` sends them. Only the
 * received messages of a conversation are touched.
 *
 * - „Neu“: in the inbox, no flag.
 * - „Handlungsbedarf“: in the inbox, the newest message with a flag and the others without, so
 *   completing that one flag in Outlook completes it there.
 * - „Erledigt“: archived; a flag still open is completed, so Outlook's task list drops it.
 * - Back from „Erledigt“: the archived messages return to the inbox (when none is archived, the
 *   newest one, e.g. from another folder).
 * - The responsible person is a category on every received message; other categories stay.
 */

export type NachrichtStand = Pick<
  InboxNachricht,
  'id' | 'am' | 'flag' | 'kategorien' | 'etag' | 'ordner'
>;

/** Where a message is moved to: the inbox or the archive (well-known folder names of Graph). */
export type Ziel = 'inbox' | 'archive';

/** The change of one message; only what differs from now is sent. */
export interface NachrichtAenderung {
  id: string;
  /** The version that was read; the change is refused when the message changed since. */
  etag?: string;
  flag?: OutlookFlag;
  kategorien?: string[];
  verschieben?: Ziel;
}

function neueste<T extends Pick<NachrichtStand, 'am'>>(nachrichten: readonly T[]): T | null {
  let ergebnis: T | null = null;
  for (const nachricht of nachrichten)
    if (!ergebnis || nachricht.am > ergebnis.am) ergebnis = nachricht;
  return ergebnis;
}

interface Soll {
  ordner: MailOrdner;
  flag: OutlookFlag;
}

/** The folder and flag each message gets for the status. */
function zielFuer(
  nachrichten: readonly NachrichtStand[],
  status: PostfachStatus
): Map<string, Soll> {
  const ergebnis = new Map<string, Soll>();
  if (status === 'erledigt') {
    for (const nachricht of nachrichten)
      ergebnis.set(nachricht.id, {
        ordner: nachricht.ordner === 'posteingang' ? 'archiv' : nachricht.ordner,
        flag: nachricht.flag === 'flagged' ? 'complete' : nachricht.flag,
      });
    return ergebnis;
  }
  // Open again: what is in the inbox stays; with nothing there the archived ones come back
  let offen = nachrichten.filter((nachricht) => nachricht.ordner === 'posteingang');
  if (!offen.length) offen = nachrichten.filter((nachricht) => nachricht.ordner === 'archiv');
  if (!offen.length) {
    const letzte = neueste(nachrichten);
    offen = letzte ? [letzte] : [];
  }
  const offenIds = new Set(offen.map((nachricht) => nachricht.id));
  const markiert = status === 'handlungsbedarf' ? neueste(offen)?.id : undefined;
  for (const nachricht of nachrichten) {
    const imPosteingang = offenIds.has(nachricht.id);
    ergebnis.set(nachricht.id, {
      ordner: imPosteingang ? 'posteingang' : nachricht.ordner,
      // Outside the inbox a flag stays as it is: it does not count there
      flag: !imPosteingang ? nachricht.flag : nachricht.id === markiert ? 'flagged' : 'notFlagged',
    });
  }
  return ergebnis;
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
  const ziele = ziel.status ? zielFuer(nachrichten, ziel.status) : null;
  return nachrichten.flatMap((nachricht) => {
    const aenderung: NachrichtAenderung = {
      id: nachricht.id,
      ...(nachricht.etag && { etag: nachricht.etag }),
    };
    const soll = ziele?.get(nachricht.id);
    if (soll && soll.flag !== nachricht.flag) aenderung.flag = soll.flag;
    if (soll && soll.ordner !== nachricht.ordner)
      aenderung.verschieben = soll.ordner === 'posteingang' ? 'inbox' : 'archive';
    if (ziel.kategorie !== undefined) {
      const kategorien = kategorienMit(nachricht.kategorien, ziel.kategorie);
      if (!gleich(kategorien, nachricht.kategorien)) aenderung.kategorien = kategorien;
    }
    return aenderung.flag || aenderung.kategorien || aenderung.verschieben ? [aenderung] : [];
  });
}

/** The messages as they are after the changes, to answer with the new state without reading. */
export function nachAenderung<T extends NachrichtStand>(
  nachrichten: readonly T[],
  geaendert: readonly NachrichtAenderung[]
): T[] {
  const byId = new Map(geaendert.map((aenderung) => [aenderung.id, aenderung]));
  return nachrichten.map((nachricht) => {
    const aenderung = byId.get(nachricht.id);
    if (!aenderung) return nachricht;
    return {
      ...nachricht,
      ...(aenderung.flag && { flag: aenderung.flag }),
      ...(aenderung.kategorien && { kategorien: aenderung.kategorien }),
      ...(aenderung.verschieben && {
        ordner: aenderung.verschieben === 'inbox' ? 'posteingang' : 'archiv',
      }),
    };
  });
}
