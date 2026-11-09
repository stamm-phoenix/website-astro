import { z } from 'zod';
import {
  collectionSchema,
  guarded,
  IMMUTABLE,
  mailboxPath,
  nextLinkOf,
  postfachGraph,
  readCollection,
  text,
} from './postfach-graph-basis';
import {
  alsAnhang,
  embedInlineImages,
  isFileAttachment,
  readAttachments,
} from './postfach-anhaenge';
import { KONVERSATION_MAX } from './postfach-model';
import type { InboxNachricht, MailAdresse, MailNachricht, OutlookFlag } from './postfach-model';

export {
  AnhangNichtLadbarError,
  PostfachZugriffError,
  postfachGraph,
} from './postfach-graph-basis';
export { ANHANG_MAX, readAnhang } from './postfach-anhaenge';

/**
 * Reading the shared mailboxes through Microsoft Graph with the API's app registration
 * (`Mail.ReadWrite`, scoped to the mailboxes with RBAC for Applications, see
 * `docs/postfaecher.md`). Reading leaves `isRead` of Outlook alone; the status and the
 * responsible person are the flags and categories of the messages (`postfach-schreiben.ts`).
 *
 * All IDs are immutable IDs (`Prefer: IdType="ImmutableId"`), so a message keeps its ID when
 * someone moves it in Outlook.
 */

/** Messages of the inbox the list reads; older ones are left to Outlook. */
export const INBOX_LIMIT = 100;
/** Messages of a conversation read per request, and the pages read at most. */
const KONVERSATION_SEITE = 50;
const KONVERSATION_SEITEN = KONVERSATION_MAX / KONVERSATION_SEITE;

const addressSchema = z
  .object({
    emailAddress: z
      .object({ name: text.optional(), address: text.optional() })
      .catch({ name: '', address: '' }),
  })
  .transform(({ emailAddress }): MailAdresse => ({
    name: (emailAddress.name ?? '').trim() || (emailAddress.address ?? '').trim(),
    adresse: (emailAddress.address ?? '').trim(),
  }));
const optionalAddress = addressSchema.nullable().optional().catch(null);
const addressList = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = addressSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
  );
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

const FLAGS = new Set<string>(['notFlagged', 'flagged', 'complete']);

const flagSchema = z
  .object({
    flagStatus: text.optional(),
    completedDateTime: z
      .object({ dateTime: text, timeZone: text.optional() })
      .nullable()
      .optional()
      .catch(null),
  })
  .nullable()
  .optional()
  .catch(null);

/** A time of Graph without zone (`dateTimeTimeZone`); Graph answers in UTC unless asked otherwise. */
function utc(value: { dateTime: string; timeZone?: string } | null | undefined): string | null {
  if (!value?.dateTime) return null;
  const zone = (value.timeZone ?? 'UTC').toUpperCase();
  if (zone !== 'UTC' && zone !== 'COORDINATED UNIVERSAL TIME') return null;
  const text = /[zZ]|[+-]\d\d:\d\d$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const listMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  subject: z.string().nullable().catch(''),
  from: optionalAddress,
  receivedDateTime: timestamp,
  bodyPreview: text.optional(),
  hasAttachments: z.boolean().catch(false),
  importance: text.optional(),
  isDraft: z.boolean().catch(false),
  flag: flagSchema,
  categories: z.array(z.string()).optional().catch([]),
  parentFolderId: z.string().nullable().catch(null).optional(),
});

const fullMessageSchema = listMessageSchema.extend({
  toRecipients: addressList.optional(),
  ccRecipients: addressList.optional(),
  body: z.object({ contentType: text, content: text }).nullable().catch(null).optional(),
});

const NO_SENDER: MailAdresse = { name: 'Unbekannt', adresse: '' };

function toInbox(message: z.output<typeof listMessageSchema>): InboxNachricht {
  return {
    id: message.id,
    konversation: message.conversationId,
    betreff: message.subject?.trim() || '(ohne Betreff)',
    von: message.from ?? NO_SENDER,
    am: new Date(message.receivedDateTime).toISOString(),
    vorschau: (message.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    hatAnhang: message.hasAttachments,
    wichtig: message.importance === 'high',
    flag: (FLAGS.has(message.flag?.flagStatus ?? '')
      ? message.flag?.flagStatus
      : 'notFlagged') as OutlookFlag,
    erledigtAm: utc(message.flag?.completedDateTime),
    kategorien: message.categories ?? [],
  };
}

const LIST_SELECT =
  'id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments,importance,isDraft,flag,categories';

/** The newest messages of the inbox; `begrenzt`: the inbox holds more than were read. */
export interface Posteingang {
  nachrichten: InboxNachricht[];
  /**
   * Received messages of the same conversations in other folders (e.g. archived), as far back as
   * the inbox reaches: their flags and categories count for the status, as in the reading view.
   */
  weitere: InboxNachricht[];
  begrenzt: boolean;
}

/** Messages of other folders read for the status of the listed conversations. */
const WEITERE_SEITEN = 2;

export async function readInbox(address: string): Promise<Posteingang> {
  return guarded(address, async () => {
    const response = await postfachGraph.get(
      `${mailboxPath(address)}/mailFolders/inbox/messages`,
      {
        $top: String(INBOX_LIMIT),
        $select: LIST_SELECT,
        $orderby: 'receivedDateTime desc',
      },
      [IMMUTABLE]
    );
    const gelesen = readCollection(listMessageSchema, response);
    const begrenzt =
      gelesen.length >= INBOX_LIMIT ||
      (collectionSchema.safeParse(response).data?.['@odata.nextLink'] ?? null) !== null;
    const nachrichten = gelesen.filter((message) => !message.isDraft).map(toInbox);
    return { nachrichten, weitere: await readWeitere(address, nachrichten), begrenzt };
  });
}

/**
 * The received messages of the listed conversations outside the inbox, since the oldest one
 * listed. Without them a flag on an archived message would show as „Neu“ in the list but as
 * „Handlungsbedarf“ in the reading view. Failing, the list still shows; the reading view and
 * every change read the whole conversation anyway.
 */
async function readWeitere(
  address: string,
  inbox: readonly InboxNachricht[]
): Promise<InboxNachricht[]> {
  if (!inbox.length) return [];
  const imPosteingang = new Set(inbox.map((nachricht) => nachricht.id));
  const konversationen = new Set(inbox.map((nachricht) => nachricht.konversation));
  const aelteste = inbox.reduce((a, b) => (b.am < a ? b.am : a), inbox[0].am);
  try {
    const path = `${mailboxPath(address)}/messages`;
    let response = await postfachGraph.get(
      path,
      {
        $filter: `receivedDateTime ge ${aelteste}`,
        $select: `${LIST_SELECT},parentFolderId`,
        $orderby: 'receivedDateTime desc',
        $top: String(INBOX_LIMIT),
      },
      [IMMUTABLE]
    );
    const gelesen = readCollection(listMessageSchema, response);
    let next = nextLinkOf(response, path);
    for (let seite = 1; next && seite < WEITERE_SEITEN; seite++) {
      response = await postfachGraph.next(next, [IMMUTABLE]);
      gelesen.push(...readCollection(listMessageSchema, response));
      next = nextLinkOf(response, path);
    }
    const ordnerIds = await ordner(address);
    return gelesen
      .filter(
        (message) =>
          !message.isDraft &&
          !imPosteingang.has(message.id) &&
          konversationen.has(message.conversationId)
      )
      .map((message) => ({ message, base: toInbox(message) }))
      .filter(({ message, base }) => !istGesendet(message, base.von, address, ordnerIds))
      .map(({ base }) => base);
  } catch (error: unknown) {
    console.error(`[postfach] Weitere Ordner von ${address} nicht lesbar`, error);
    return [];
  }
}

const folderSchema = z.object({ id: z.string().min(1) });
const sentItemsCache = new Map<string, string>();

/**
 * The ID of a well-known folder of the mailbox, in the same ID format as `parentFolderId`; null
 * when Graph does not tell. Without „Gesendete Elemente“ every message counts as received:
 * better read twice than never.
 */
async function ordnerId(address: string, ordner: 'sentitems' | 'inbox'): Promise<string | null> {
  const key = `${address}|${ordner}`;
  const cached = sentItemsCache.get(key);
  if (cached) return cached;
  const response = await postfachGraph
    .get(`${mailboxPath(address)}/mailFolders/${ordner}`, { $select: 'id' }, [IMMUTABLE])
    .catch(() => null);
  const parsed = folderSchema.safeParse(response);
  if (!parsed.success) return null;
  sentItemsCache.set(key, parsed.data.id);
  return parsed.data.id;
}

/** For the tests. */
export function resetSentItemsCache(): void {
  sentItemsCache.clear();
}

/** The folders that tell sent from received messages. */
interface Ordner {
  gesendet: string | null;
  posteingang: string | null;
}

async function ordner(address: string): Promise<Ordner> {
  const [gesendet, posteingang] = await Promise.all([
    ordnerId(address, 'sentitems'),
    ordnerId(address, 'inbox'),
  ]);
  return { gesendet, posteingang };
}

/**
 * Sent: in „Gesendete Elemente“, or from the mailbox itself and moved elsewhere (e.g. an
 * archived answer). From the mailbox but in the inbox: a note of the forms, which send from the
 * mailbox to itself, so it was received.
 */
function istGesendet(
  message: Pick<z.output<typeof listMessageSchema>, 'parentFolderId'>,
  von: MailAdresse,
  address: string,
  { gesendet, posteingang }: Ordner
): boolean {
  return (
    (gesendet !== null && message.parentFolderId === gesendet) ||
    (von.adresse.toLowerCase() === address.toLowerCase() &&
      posteingang !== null &&
      message.parentFolderId !== posteingang)
  );
}

/** The messages of a conversation in every folder, oldest first, with up to 200 read. */
async function readKonversationsNachrichten<S extends typeof listMessageSchema>(
  address: string,
  konversationId: string,
  schema: S,
  select: string,
  prefer: string[]
): Promise<{ messages: z.output<S>[]; vollstaendig: boolean }> {
  const path = `${mailboxPath(address)}/messages`;
  // Sorting together with this filter is refused by Exchange; the list is sorted here
  let response = await postfachGraph.get(
    path,
    {
      $filter: `conversationId eq '${konversationId.replaceAll("'", "''")}'`,
      $select: select,
      $top: String(KONVERSATION_SEITE),
    },
    prefer
  );
  const gelesen = readCollection(schema, response);
  let next = nextLinkOf(response, path);
  for (let seite = 1; next && seite < KONVERSATION_SEITEN; seite++) {
    response = await postfachGraph.next(next, prefer);
    gelesen.push(...readCollection(schema, response));
    next = nextLinkOf(response, path);
  }
  const messages = gelesen
    .filter((message) => !message.isDraft && message.conversationId === konversationId)
    .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
  return { messages, vollstaendig: next === null };
}

/**
 * The received messages of a conversation in every folder, without bodies, with their flags and
 * categories: what a change of the status or the responsible person works on.
 */
export async function readKonversationStand(
  address: string,
  konversationId: string
): Promise<{ nachrichten: InboxNachricht[]; vollstaendig: boolean }> {
  return guarded(address, async () => {
    const { messages, vollstaendig } = await readKonversationsNachrichten(
      address,
      konversationId,
      listMessageSchema,
      `${LIST_SELECT},parentFolderId`,
      [IMMUTABLE]
    );
    const ordnerIds = await ordner(address);
    const nachrichten = messages
      .map((message) => ({ message, base: toInbox(message) }))
      .filter(({ message, base }) => !istGesendet(message, base.von, address, ordnerIds))
      .map(({ base }) => base);
    return { nachrichten, vollstaendig };
  });
}

/**
 * All messages of a conversation in the mailbox, in every folder (so answers from Sent Items
 * show), oldest first; `eingegangen` are the received ones with their flags and categories.
 */
export async function readKonversation(
  address: string,
  konversationId: string
): Promise<{ nachrichten: MailNachricht[]; eingegangen: InboxNachricht[]; vollstaendig: boolean }> {
  return guarded(address, async () => {
    const { messages, vollstaendig } = await readKonversationsNachrichten(
      address,
      konversationId,
      fullMessageSchema,
      `${LIST_SELECT},parentFolderId,toRecipients,ccRecipients,body`,
      [IMMUTABLE, 'outlook.body-content-type="html"']
    );
    const ordnerIds = await ordner(address);
    const eingegangen: InboxNachricht[] = [];
    const nachrichten = await Promise.all(
      messages.map(async (message): Promise<MailNachricht> => {
        const base = toInbox(message);
        const gesendet = istGesendet(message, base.von, address, ordnerIds);
        if (!gesendet) eingegangen.push(base);
        const isHtml = message.body?.contentType.toLowerCase() === 'html';
        let html = isHtml ? (message.body?.content ?? '') : null;
        const mitCid = html !== null && /cid:/i.test(html);
        const needsAttachments = message.hasAttachments || mitCid;
        const attachments = needsAttachments ? await readAttachments(address, message.id) : [];
        let eingebettet = new Set<string>();
        if (html !== null && mitCid) {
          ({ html, eingebettet } = await embedInlineImages(
            address,
            message.id,
            html,
            attachments.filter((entry) => entry.isInline && isFileAttachment(entry))
          ));
        }
        return {
          id: base.id,
          von: base.von,
          an: message.toRecipients ?? [],
          cc: message.ccRecipients ?? [],
          am: base.am,
          betreff: base.betreff,
          vorschau: base.vorschau,
          html,
          text: isHtml ? null : (message.body?.content ?? base.vorschau),
          // Inline images too large to embed stay reachable as attachments
          anhaenge: attachments.filter((entry) => !eingebettet.has(entry.id)).map(alsAnhang),
          gesendet,
          // Unknown folder: counted as in the inbox, as the list did before
          imPosteingang:
            ordnerIds.posteingang === null || message.parentFolderId === ordnerIds.posteingang,
        };
      })
    );
    return { nachrichten, eingegangen, vollstaendig };
  });
}

const translateSchema = z.object({
  value: z.array(z.object({ targetId: z.string().min(1) })).min(1),
});

/** The REST ID Outlook on the web needs for a message, or null if Graph cannot tell. */
export async function readRestId(address: string, immutableId: string): Promise<string | null> {
  try {
    const response = await postfachGraph.post(`${mailboxPath(address)}/translateExchangeIds`, {
      inputIds: [immutableId],
      sourceIdType: 'restImmutableEntryId',
      targetIdType: 'restId',
    });
    const parsed = translateSchema.safeParse(response);
    return parsed.success ? parsed.data.value[0].targetId : null;
  } catch {
    // Without the link the reading view still works; the mailbox link remains
    return null;
  }
}
