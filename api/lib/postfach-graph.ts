import { z } from 'zod';
import { getGraphStatus } from './sharepoint-data-access';
import { getClient } from './token';
import { KONVERSATION_MAX } from './postfach-model';
import type { InboxNachricht, MailAdresse, MailAnhang, MailNachricht } from './postfach-model';

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
/** Inline images up to this size are embedded, at most `INLINE_TOTAL` per message. */
const INLINE_MAX = 1_000_000;
const INLINE_TOTAL = 4_000_000;
/** Attachments up to this size are downloaded through the API; larger ones in Outlook. */
export const ANHANG_MAX = 25_000_000;
const TIMEOUT_MS = 10_000;

const IMMUTABLE = 'IdType="ImmutableId"';

/** Graph refused the mailbox: the app may not read it, or it does not exist. */
export class PostfachZugriffError extends Error {
  constructor(public readonly address: string) {
    super(`Graph refused the mailbox ${address}.`);
    this.name = 'PostfachZugriffError';
  }
}

/** The attachment cannot be downloaded here (too large, or an attached item instead of a file). */
export class AnhangNichtLadbarError extends Error {
  constructor() {
    super('The attachment cannot be downloaded through the API.');
    this.name = 'AnhangNichtLadbarError';
  }
}

/** Graph requests of this module; a seam for the tests. */
export const postfachGraph = {
  async get(path: string, query: Record<string, string>, prefer: string[]): Promise<unknown> {
    return getClient()
      .api(path)
      .query(query)
      .header('Prefer', prefer.join(', '))
      .option('signal', AbortSignal.timeout(TIMEOUT_MS))
      .get();
  },
  /** The next page of a collection, from its `@odata.nextLink`. */
  async next(url: string, prefer: string[]): Promise<unknown> {
    return getClient()
      .api(url)
      .header('Prefer', prefer.join(', '))
      .option('signal', AbortSignal.timeout(TIMEOUT_MS))
      .get();
  },
  async post(path: string, body: unknown): Promise<unknown> {
    return getClient().api(path).option('signal', AbortSignal.timeout(TIMEOUT_MS)).post(body);
  },
};

function mailboxPath(address: string): string {
  return `/users/${encodeURIComponent(address)}`;
}

/** Maps a refusal of Graph (403, 404) to `PostfachZugriffError`; other errors pass. */
async function guarded<T>(address: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    const status = getGraphStatus(error);
    if (status === 401 || status === 403 || status === 404) throw new PostfachZugriffError(address);
    throw error;
  }
}

const text = z.string().catch('');
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
  toRecipients: addressList.optional(),
  ccRecipients: addressList.optional(),
  body: z.object({ contentType: text, content: text }).nullable().catch(null).optional(),
});

const collectionSchema = z.object({
  value: z.array(z.unknown()),
  '@odata.nextLink': z.string().optional(),
});

/** A continuation must stay on Graph and on the path it continues. */
function nextLinkOf(response: unknown, path: string): string | null {
  const parsed = collectionSchema.safeParse(response);
  const next = parsed.success ? parsed.data['@odata.nextLink'] : undefined;
  if (!next) return null;
  const url = new URL(next);
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.endsWith(path))
    throw new Error('Invalid Graph continuation');
  return next;
}

/** Entries that do not parse are skipped, so one odd message does not hide the mailbox. */
function readCollection<S extends z.ZodType>(schema: S, response: unknown): z.output<S>[] {
  const parsed = collectionSchema.safeParse(response);
  if (!parsed.success) throw new Error('Invalid Graph message collection');
  return parsed.data.value.flatMap((item) => {
    const entry = schema.safeParse(item);
    return entry.success ? [entry.data] : [];
  });
}

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
export async function readInbox(address: string): Promise<InboxNachricht[]> {
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
    return readCollection(listMessageSchema, response)
      .filter((message) => !message.isDraft)
      .map(toInbox);
  });
}

const attachmentMetaSchema = z.object({
  '@odata.type': text.optional(),
  id: z.string().min(1),
  name: text,
  contentType: text,
  size: z.number().catch(0),
  isInline: z.boolean().catch(false),
});

const fileAttachmentSchema = z.object({
  name: text,
  contentType: text,
  contentId: z.string().nullable().catch(null).optional(),
  contentBytes: z.string(),
  size: z.number().catch(0),
});

function isFileAttachment(entry: z.output<typeof attachmentMetaSchema>): boolean {
  return !entry['@odata.type'] || entry['@odata.type'] === '#microsoft.graph.fileAttachment';
}

/** Replaces `cid:` references with `data:` URLs of the inline images, within the size limits. */
async function embedInlineImages(
  address: string,
  messageId: string,
  html: string,
  inline: z.output<typeof attachmentMetaSchema>[]
): Promise<string> {
  let total = 0;
  let result = html;
  for (const entry of inline) {
    if (!entry.contentType.startsWith('image/') || entry.size > INLINE_MAX) continue;
    if (total + entry.size > INLINE_TOTAL) break;
    const file = fileAttachmentSchema.safeParse(
      await postfachGraph.get(
        `${mailboxPath(address)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(entry.id)}`,
        {},
        [IMMUTABLE]
      )
    );
    if (!file.success || !file.data.contentId) continue;
    total += entry.size;
    const cid = file.data.contentId.replace(/^<|>$/g, '');
    const url = `data:${file.data.contentType};base64,${file.data.contentBytes}`;
    result = result.split(`cid:${cid}`).join(url);
  }
  return result;
}

async function readAttachments(
  address: string,
  messageId: string
): Promise<z.output<typeof attachmentMetaSchema>[]> {
  const response = await postfachGraph.get(
    `${mailboxPath(address)}/messages/${encodeURIComponent(messageId)}/attachments`,
    { $select: 'id,name,contentType,size,isInline' },
    [IMMUTABLE]
  );
  return readCollection(attachmentMetaSchema, response);
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
        $select: `${LIST_SELECT},toRecipients,ccRecipients,body`,
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
    const own = address.toLowerCase();
    const nachrichten = await Promise.all(
      messages.map(async (message) => {
        const base = toInbox(message);
        const isHtml = message.body?.contentType.toLowerCase() === 'html';
        let html = isHtml ? (message.body?.content ?? '') : null;
        const needsAttachments = message.hasAttachments || (html?.includes('cid:') ?? false);
        const attachments = needsAttachments ? await readAttachments(address, message.id) : [];
        if (html?.includes('cid:')) {
          html = await embedInlineImages(
            address,
            message.id,
            html,
            attachments.filter((entry) => entry.isInline && isFileAttachment(entry))
          );
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
          anhaenge: attachments
            .filter((entry) => !entry.isInline)
            .map((entry): MailAnhang => ({
              id: entry.id,
              name: entry.name || 'Anhang',
              groesse: entry.size,
              typ: isFileAttachment(entry) ? entry.contentType : 'message/rfc822',
              herunterladbar: isFileAttachment(entry) && entry.size <= ANHANG_MAX,
            })),
          gesendet: base.von.adresse.toLowerCase() === own,
        };
      })
    );
    return { nachrichten, vollstaendig: next === null };
  });
}

/** One attachment of a message as a file. */
export async function readAnhang(
  address: string,
  messageId: string,
  anhangId: string
): Promise<{ name: string; contentType: string; content: Buffer }> {
  return guarded(address, async () => {
    const path = `${mailboxPath(address)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(anhangId)}`;
    const meta = attachmentMetaSchema.safeParse(
      await postfachGraph.get(path, { $select: 'id,name,contentType,size,isInline' }, [IMMUTABLE])
    );
    if (!meta.success || !isFileAttachment(meta.data) || meta.data.size > ANHANG_MAX)
      throw new AnhangNichtLadbarError();
    const file = fileAttachmentSchema.safeParse(await postfachGraph.get(path, {}, [IMMUTABLE]));
    if (!file.success) throw new AnhangNichtLadbarError();
    return {
      name: file.data.name || 'Anhang',
      contentType: file.data.contentType || 'application/octet-stream',
      content: Buffer.from(file.data.contentBytes, 'base64'),
    };
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
