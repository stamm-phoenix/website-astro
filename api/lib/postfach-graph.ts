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
import type { InboxNachricht, MailAdresse, MailNachricht } from './postfach-model';

export {
  AnhangNichtLadbarError,
  PostfachZugriffError,
  postfachGraph,
} from './postfach-graph-basis';
export { ANHANG_MAX, readAnhang } from './postfach-anhaenge';

/**
 * Reading the shared mailboxes through Microsoft Graph with the API's app registration
 * (`Mail.Read`, scoped to the mailboxes with RBAC for Applications, see `docs/postfaecher.md`).
 * Nothing is changed in the mailbox: reading with Graph leaves `isRead` of Outlook alone, and the
 * read state of each person lives in Azure SQL.
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
});

const fullMessageSchema = listMessageSchema.extend({
  parentFolderId: z.string().nullable().catch(null).optional(),
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
  };
}

const LIST_SELECT =
  'id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments,importance,isDraft';

/** The newest messages of the inbox, newest first. */
/** The newest messages of the inbox; `begrenzt`: the inbox holds more than were read. */
export interface Posteingang {
  nachrichten: InboxNachricht[];
  begrenzt: boolean;
}

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
    return {
      nachrichten: gelesen.filter((message) => !message.isDraft).map(toInbox),
      begrenzt,
    };
  });
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

/**
 * All messages of a conversation in the mailbox, in every folder (so answers from Sent Items
 * show), oldest first. `gelesen` is filled in by the caller.
 */
export async function readKonversation(
  address: string,
  konversationId: string
): Promise<{ nachrichten: Omit<MailNachricht, 'gelesen'>[]; vollstaendig: boolean }> {
  return guarded(address, async () => {
    const path = `${mailboxPath(address)}/messages`;
    const prefer = [IMMUTABLE, 'outlook.body-content-type="html"'];
    // Sorting together with this filter is refused by Exchange; the list is sorted here
    let response = await postfachGraph.get(
      path,
      {
        $filter: `conversationId eq '${konversationId.replaceAll("'", "''")}'`,
        $select: `${LIST_SELECT},parentFolderId,toRecipients,ccRecipients,body`,
        $top: String(KONVERSATION_SEITE),
      },
      prefer
    );
    const gelesen = readCollection(fullMessageSchema, response);
    let next = nextLinkOf(response, path);
    for (let seite = 1; next && seite < KONVERSATION_SEITEN; seite++) {
      response = await postfachGraph.next(next, prefer);
      gelesen.push(...readCollection(fullMessageSchema, response));
      next = nextLinkOf(response, path);
    }
    const messages = gelesen
      .filter((message) => !message.isDraft && message.conversationId === konversationId)
      .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
    const [gesendetOrdner, posteingang] = await Promise.all([
      ordnerId(address, 'sentitems'),
      ordnerId(address, 'inbox'),
    ]);
    const nachrichten = await Promise.all(
      messages.map(async (message) => {
        const base = toInbox(message);
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
          // Sent: in „Gesendete Elemente“, or from the mailbox itself and moved elsewhere (e.g.
          // an archived answer). From the mailbox but in the inbox: a note of the forms, which
          // send from the mailbox to itself, so it was received
          gesendet:
            (gesendetOrdner !== null && message.parentFolderId === gesendetOrdner) ||
            (base.von.adresse.toLowerCase() === address.toLowerCase() &&
              posteingang !== null &&
              message.parentFolderId !== posteingang),
          // Unknown folder: counted as in the inbox, as the list did before
          imPosteingang: posteingang === null || message.parentFolderId === posteingang,
        };
      })
    );
    return { nachrichten, vollstaendig: next === null };
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
