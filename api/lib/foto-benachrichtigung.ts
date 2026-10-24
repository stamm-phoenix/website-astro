/**
 * Note to the leaders that someone uploaded new photos (module „Fotos“, `docs/fotos.md`): one
 * mail in blind copy with a few small previews in the text and a link to the folder. The
 * recipients come from CampFlow like those of the minutes and can be changed per mail.
 */
import type { CampflowPerson } from './campflow';
import { campflowGetAll } from './campflow';
import { CONFIG } from './config';
import { fotoAnzahlText } from './foto-pfade';
import type { FotoFile, FotoThumbnail } from './fotos';
import { getFotoThumbnail } from './fotos';
import type { MailAttachment } from './mail';
import { escapeHtml, sendBlindCopyMail } from './mail';
import { mailButton, mailLayout } from './mail-template';
import type { ProtokollRecipient } from './protokolle';
import { protokollRecipients } from './protokolle';

/** Previews shown in the mail; more make it long on a phone. */
export const FOTO_MAIL_PREVIEWS = 6;
/** Edge of a preview in the mail, in pixels. */
const PREVIEW_SIZE = 160;

/**
 * Current members of the groups in `CONFIG.fotos.campflowGroups`; throws `CampflowError`. Read
 * fresh from CampFlow, not from the list shared for a minute, so the version confirmed before
 * sending sees a change made in between.
 */
export async function loadFotoRecipients(): Promise<ProtokollRecipient[]> {
  const persons = await campflowGetAll<CampflowPerson>('/lists/member/persons');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  return protokollRecipients(persons, today, CONFIG.fotos.campflowGroups);
}

/**
 * Name of the folder in the text: the last two levels, so `Aktionen/2026/Sola/Nico` reads
 * „Sola / Nico“ and not only the first name.
 */
export function fotoOrdnerTitel(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join(' / ');
}

export interface FotoBenachrichtigung {
  /** First name of the person who uploaded. */
  person: string;
  /** Login of that person; replies go there. */
  replyTo: string;
  /** Folder inside the library. */
  path: string;
  /** The new files, in the order they are shown. */
  files: FotoFile[];
  /** Link to the folder in the Leitendenbereich. */
  url: string;
}

/** Subject and text of the mail; `previews` are the content IDs of the attached previews. */
export function fotoMailContent(
  data: Omit<FotoBenachrichtigung, 'replyTo'>,
  previews: { contentId: string; name: string }[]
): { subject: string; html: string } {
  const anzahl = fotoAnzahlText(data.files);
  const titel = fotoOrdnerTitel(data.path);
  const more = data.files.length - previews.length;
  // Three per row that shrink on a phone; Outlook takes the size from the attributes
  const cells = previews.map(
    (preview) => `<td width="33%" style="padding:3px;width:33%;vertical-align:top;">
          <img src="cid:${escapeHtml(preview.contentId)}" alt="${escapeHtml(preview.name)}" width="${PREVIEW_SIZE}" height="${PREVIEW_SIZE}" style="display:block;width:100%;max-width:${PREVIEW_SIZE}px;height:auto;border:0;border-radius:4px;background:#e5e7eb;" />
        </td>`
  );
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 3) {
    const row = cells.slice(index, index + 3);
    while (row.length < 3) row.push('<td width="33%" style="width:33%;"></td>');
    rows.push(`<tr>${row.join('')}</tr>`);
  }
  const gallery = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:${PREVIEW_SIZE * 3 + 18}px;margin:16px 0 4px;border-collapse:collapse;">${rows.join('')}</table>
      ${more > 0 ? `<p style="margin:0 0 8px;font-size:13px;color:#6b7280;">und ${more} weitere</p>` : ''}`
    : '';
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">Neue Fotos: ${escapeHtml(titel)}</h1>
    <p>Hallo zusammen,</p>
    <p><strong>${escapeHtml(data.person)}</strong> hat ${escapeHtml(anzahl)} in den Ordner
      <strong>${escapeHtml(titel)}</strong> hochgeladen.</p>
    ${gallery}
    ${mailButton(data.url, 'Fotos ansehen', 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    <p style="font-size:13px;color:#6b7280;">Ordner in der Foto-Ablage: ${escapeHtml(data.path.split('/').join(' / '))}.
      Der Link funktioniert nach der Anmeldung mit einem Stammes-Account.</p>
  `);
  return { subject: `${data.person} hat ${anzahl} hochgeladen: ${titel}`, html };
}

/** Sends the note in blind copy, with previews of the first photos and videos in the text. */
export async function sendFotoBenachrichtigung(
  recipients: string[],
  data: FotoBenachrichtigung
): Promise<void> {
  const candidates = data.files.filter((file) => file.kind !== 'file').slice(0, FOTO_MAIL_PREVIEWS);
  const loaded = await Promise.all(
    candidates.map(async (file): Promise<[FotoFile, FotoThumbnail | null]> => [
      file,
      await getFotoThumbnail(file.id),
    ])
  );
  const attachments: MailAttachment[] = [];
  const previews: { contentId: string; name: string }[] = [];
  for (const [file, thumbnail] of loaded) {
    if (!thumbnail) continue;
    const contentId = `foto-${previews.length + 1}@stamm-phoenix.de`;
    const extension = thumbnail.contentType === 'image/png' ? 'png' : 'jpg';
    attachments.push({
      name: `vorschau-${previews.length + 1}.${extension}`,
      contentType: thumbnail.contentType,
      content: thumbnail.content,
      contentId,
    });
    previews.push({ contentId, name: file.name });
  }
  const { subject, html } = fotoMailContent(data, previews);
  await sendBlindCopyMail({
    sender: CONFIG.fotos.sender,
    bcc: recipients,
    subject,
    html,
    attachments,
    replyTo: { address: data.replyTo, name: data.person },
  });
}

/** CampFlow and the mail of this module; a seam for the tests. */
export const fotoMail = {
  recipients: loadFotoRecipients,
  send: sendFotoBenachrichtigung,
};
