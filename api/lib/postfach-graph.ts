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
import type {
  InboxNachricht,
  MailAdresse,
  MailNachricht,
  MailOrdner,
  OutlookFlag,
} from './postfach-model';

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
  })
  .nullable()
  .optional()
  .catch(null);

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
  isRead: z.boolean().catch(true),
  flag: flagSchema,
  '@odata.etag': z.string().optional().catch(undefined),
  categories: z.array(z.string()).optional().catch([]),
  parentFolderId: z.string().nullable().catch(null).optional(),
  toRecipients: addressList.optional(),
});

const fullMessageSchema = listMessageSchema.extend({
  ccRecipients: addressList.optional(),
  body: z.object({ contentType: text, content: text }).nullable().catch(null).optional(),
});

const NO_SENDER: MailAdresse = { name: 'Unbekannt', adresse: '' };

function toInbox(
  message: z.output<typeof listMessageSchema>,
  ordner: MailOrdner = 'posteingang'
): InboxNachricht {
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
    kategorien: message.categories ?? [],
    gelesen: message.isRead,
    ordner,
    ...(message['@odata.etag'] && { etag: message['@odata.etag'] }),
  };
}

const LIST_SELECT =
  'id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments,importance,isDraft,isRead,flag,categories';

/**
 * What the list of a mailbox reads: the newest messages of the inbox and of the archive, and the
 * received messages of the inbox's conversations in other folders. `begrenzt`: the inbox or the
 * archive holds more than were read.
 */
export interface Posteingang {
  nachrichten: InboxNachricht[];
  begrenzt: boolean;
}

/** Messages of other folders read for the person of the listed conversations. */
const WEITERE_SEITEN = 2;

const KOPF_SELECT = `${LIST_SELECT},parentFolderId,toRecipients`;

async function readOrdner(
  address: string,
  ordnerName: 'inbox' | 'archive'
): Promise<{ messages: z.output<typeof listMessageSchema>[]; begrenzt: boolean }> {
  const response = await postfachGraph.get(
    `${mailboxPath(address)}/mailFolders/${ordnerName}/messages`,
    { $top: String(INBOX_LIMIT), $select: KOPF_SELECT, $orderby: 'receivedDateTime desc' },
    [IMMUTABLE]
  );
  const messages = readCollection(listMessageSchema, response);
  const begrenzt =
    messages.length >= INBOX_LIMIT ||
    (collectionSchema.safeParse(response).data?.['@odata.nextLink'] ?? null) !== null;
  return { messages: messages.filter((message) => !message.isDraft), begrenzt };
}

export async function readInbox(address: string): Promise<Posteingang> {
  return guarded(address, async () => {
    const [inbox, archiv, ordnerIds] = await Promise.all([
      readOrdner(address, 'inbox'),
      // A mailbox without an archive has nothing done there; the inbox still shows
      readOrdner(address, 'archive').catch((error: unknown) => {
        console.error(`[postfach] Archiv von ${address} nicht lesbar`, error);
        return { messages: [], begrenzt: false };
      }),
      ordner(address),
    ]);
    const offen = inbox.messages.map((message) => toInbox(message, 'posteingang'));
    const erledigt = archiv.messages
      .map((message) => ({ message, base: toInbox(message, 'archiv') }))
      .filter(({ message, base }) => !istGesendet(message, base.von, address, ordnerIds))
      .map(({ base }) => base);
    // With more in the inbox than was read, an archived conversation may still have an older
    // message there: then it is open, not done
    const aelterOffen = inbox.begrenzt ? await readImPosteingang(address, offen, erledigt) : [];
    return {
      nachrichten: [
        ...offen,
        ...aelterOffen,
        ...erledigt,
        ...(await readWeitere(address, offen, ordnerIds)),
      ],
      begrenzt: inbox.begrenzt || archiv.begrenzt,
    };
  });
}

/** Conversations asked for in one filter; Graph limits the length of a filter. */
const KONVERSATIONEN_JE_ABFRAGE = 10;

/**
 * The messages still in the inbox of the archived conversations that are not among the inbox
 * messages read. Failing, these conversations show as done until the inbox is smaller; the
 * reading view and every change read the whole conversation anyway.
 */
async function readImPosteingang(
  address: string,
  offen: readonly InboxNachricht[],
  erledigt: readonly InboxNachricht[]
): Promise<InboxNachricht[]> {
  const gelesen = new Set(offen.map((nachricht) => nachricht.konversation));
  const gesucht = [...new Set(erledigt.map((nachricht) => nachricht.konversation))].filter(
    (konversation) => !gelesen.has(konversation)
  );
  const path = `${mailboxPath(address)}/mailFolders/inbox/messages`;
  const teile: string[][] = [];
  for (let start = 0; start < gesucht.length; start += KONVERSATIONEN_JE_ABFRAGE)
    teile.push(gesucht.slice(start, start + KONVERSATIONEN_JE_ABFRAGE));
  try {
    const antworten = await Promise.all(
      teile.map((teil) =>
        postfachGraph.get(
          path,
          {
            $filter: teil
              .map((konversation) => `conversationId eq '${konversation.replaceAll("'", "''")}'`)
              .join(' or '),
            $select: KOPF_SELECT,
            $top: String(INBOX_LIMIT),
          },
          [IMMUTABLE]
        )
      )
    );
    return antworten
      .flatMap((antwort) => readCollection(listMessageSchema, antwort))
      .filter((message) => !message.isDraft && gesucht.includes(message.conversationId))
      .map((message) => toInbox(message, 'posteingang'));
  } catch (error: unknown) {
    console.error(
      `[postfach] Ältere Nachrichten im Posteingang von ${address} nicht lesbar`,
      error
    );
    return [];
  }
}

/**
 * The received messages of the conversations in the inbox outside it, since the oldest one
 * listed: an earlier message may name the responsible person, as in the reading view. Failing,
 * the list still shows; the reading view and every change read the whole conversation anyway.
 */
async function readWeitere(
  address: string,
  inbox: readonly InboxNachricht[],
  ordnerIds: Ordner
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
        $select: KOPF_SELECT,
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
    return gelesen
      .filter(
        (message) =>
          !message.isDraft &&
          !imPosteingang.has(message.id) &&
          konversationen.has(message.conversationId)
      )
      .map((message) => ({ message, base: toInbox(message, ordnerVon(message, ordnerIds)) }))
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
async function ordnerId(
  address: string,
  ordner: 'sentitems' | 'inbox' | 'archive'
): Promise<string | null> {
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

/** The folders that tell sent from received messages, and open from done ones. */
interface Ordner {
  gesendet: string | null;
  posteingang: string | null;
  archiv: string | null;
}

async function ordner(address: string): Promise<Ordner> {
  const [gesendet, posteingang, archiv] = await Promise.all([
    ordnerId(address, 'sentitems'),
    ordnerId(address, 'inbox'),
    ordnerId(address, 'archive'),
  ]);
  return { gesendet, posteingang, archiv };
}

/** Whether the mailbox has an archive to move done conversations to. */
export async function hatArchiv(address: string): Promise<boolean> {
  return (await ordnerId(address, 'archive')) !== null;
}

/** Where a message lies; unknown folders count as the inbox, as the list did before. */
function ordnerVon(
  message: Pick<z.output<typeof listMessageSchema>, 'parentFolderId'>,
  { posteingang, archiv }: Ordner
): MailOrdner {
  if (posteingang === null || message.parentFolderId === posteingang) return 'posteingang';
  return archiv !== null && message.parentFolderId === archiv ? 'archiv' : 'anderer';
}

/**
 * Sent: in „Gesendete Elemente“, or from the mailbox itself and moved elsewhere (e.g. an
 * archived answer). A note of the forms is sent by the mailbox to itself, so it was received,
 * in the inbox or archived.
 */
function istGesendet(
  message: Pick<z.output<typeof listMessageSchema>, 'parentFolderId' | 'toRecipients'>,
  von: MailAdresse,
  address: string,
  { gesendet, posteingang }: Ordner
): boolean {
  if (gesendet !== null && message.parentFolderId === gesendet) return true;
  const vomPostfach = von.adresse.toLowerCase() === address.toLowerCase();
  const anPostfach = (message.toRecipients ?? []).some(
    (empfaenger) => empfaenger.adresse.toLowerCase() === address.toLowerCase()
  );
  return (
    vomPostfach && !anPostfach && posteingang !== null && message.parentFolderId !== posteingang
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
      `${LIST_SELECT},parentFolderId,toRecipients`,
      [IMMUTABLE]
    );
    const ordnerIds = await ordner(address);
    const nachrichten = messages
      .map((message) => ({ message, base: toInbox(message, ordnerVon(message, ordnerIds)) }))
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
        const base = toInbox(message, ordnerVon(message, ordnerIds));
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
          imPosteingang: base.ordner === 'posteingang',
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
