import { z } from 'zod';
import type { MailAnhang } from './postfach-model';
import {
  AnhangNichtLadbarError,
  guarded,
  IMMUTABLE,
  mailboxPath,
  nextLinkOf,
  postfachGraph,
  readCollection,
  text,
} from './postfach-graph-basis';

/**
 * Attachments of the messages of the module „E-Mail“: the list per message, inline images
 * embedded as `data:` URLs and the download of one file.
 */

/** Inline images up to this size are embedded, at most `INLINE_TOTAL` per message. */
const INLINE_MAX = 1_000_000;
const INLINE_TOTAL = 4_000_000;
/** Attachments up to this size are downloaded through the API; larger ones in Outlook. */
export const ANHANG_MAX = 25_000_000;
/** Attachment pages read at most; more than that are very large mails. */
const ANHANG_SEITEN = 5;

export const attachmentMetaSchema = z.object({
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

export function isFileAttachment(entry: z.output<typeof attachmentMetaSchema>): boolean {
  return !entry['@odata.type'] || entry['@odata.type'] === '#microsoft.graph.fileAttachment';
}

/** Replaces `cid:` references with `data:` URLs of the inline images, within the size limits. */
export async function embedInlineImages(
  address: string,
  messageId: string,
  html: string,
  inline: z.output<typeof attachmentMetaSchema>[]
): Promise<{ html: string; eingebettet: Set<string> }> {
  let total = 0;
  let result = html;
  // The IDs of the attachments that are now part of the text; the others stay attachments
  const eingebettet = new Set<string>();
  for (const entry of inline) {
    if (!entry.contentType.startsWith('image/') || entry.size > INLINE_MAX) continue;
    if (total + entry.size > INLINE_TOTAL) continue;
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
    // The whole reference only: `cid:image1` must not eat the start of `cid:image10`
    const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`cid:${escaped}(?![\\w.@-])`, 'g'), () => url);
    eingebettet.add(entry.id);
  }
  return { html: result, eingebettet };
}

export async function readAttachments(
  address: string,
  messageId: string
): Promise<z.output<typeof attachmentMetaSchema>[]> {
  const path = `${mailboxPath(address)}/messages/${encodeURIComponent(messageId)}/attachments`;
  let response = await postfachGraph.get(path, { $select: 'id,name,contentType,size,isInline' }, [
    IMMUTABLE,
  ]);
  const anhaenge = readCollection(attachmentMetaSchema, response);
  let next = nextLinkOf(response, path);
  for (let seite = 1; next && seite < ANHANG_SEITEN; seite++) {
    response = await postfachGraph.next(next, [IMMUTABLE]);
    anhaenge.push(...readCollection(attachmentMetaSchema, response));
    next = nextLinkOf(response, path);
  }
  return anhaenge;
}

/** An attachment as the reading view lists it. */
export function alsAnhang(entry: z.output<typeof attachmentMetaSchema>): MailAnhang {
  return {
    id: entry.id,
    name: entry.name || 'Anhang',
    groesse: entry.size,
    typ: isFileAttachment(entry) ? entry.contentType : 'message/rfc822',
    herunterladbar: isFileAttachment(entry) && entry.size <= ANHANG_MAX,
  };
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
