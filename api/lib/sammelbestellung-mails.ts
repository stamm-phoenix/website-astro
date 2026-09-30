import { EnvironmentVariable, getEnvironment } from './environment';
import { escapeHtml, sendMail } from './mail';
import { mailLayout, mailButton, mailMessageBlock } from './mail-template';
import type { SammelAktion, SammelBestellung } from './sammelbestellung-model';
import type { SammelMessageInput } from './sammelbestellung-validation';

export async function sendSammelStaffMessage(
  campaign: SammelAktion,
  order: SammelBestellung,
  input: SammelMessageInput,
  senderName: string,
  url: string
): Promise<void> {
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">Nachricht zu deiner Sammelbestellung</h1>
    <p>Hallo ${escapeHtml(order.name)},</p>
    <p>zu deiner Bestellung für <strong>${escapeHtml(campaign.title)}</strong> haben wir eine Nachricht für dich:</p>
    ${mailMessageBlock(input.messageHtml)}
    <p>Viele Grüße<br />${escapeHtml(senderName)} für das Sammelbestellteam</p>
    <p style="font-size:13px;color:#6b7280;">Du kannst direkt auf diese E-Mail antworten. Deine Antwort landet bei unserem Team.</p>
    ${mailButton(url, 'Meine Bestellung öffnen', 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    <p style="font-size:12px;color:#6b7280;">Bitte teile diesen persönlichen Bestelllink nicht.</p>
  `);
  await sendMail(
    order.email,
    `${campaign.title}: ${input.subject}`,
    html,
    getEnvironment(EnvironmentVariable.SAMMELBESTELLUNG_MAIL_SENDER)
  );
}

function formatDeadline(campaign: SammelAktion): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(campaign.endsAt));
}

export async function sendSammelLinkMail(
  address: string,
  campaign: SammelAktion,
  url: string
): Promise<void> {
  const deadline = formatDeadline(campaign);
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">${escapeHtml(campaign.title)}</h1>
    <p>Hallo,</p>
    <p>hier ist dein persönlicher Link zur Sammelbestellung. Darüber kannst du deine Bestellung
      abgeben, bearbeiten und den aktuellen Stand ansehen.</p>
    ${mailButton(url, 'Meine Bestellung öffnen', 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    <p>Änderungen sind bis <strong>${escapeHtml(deadline)} Uhr (Europe/Berlin)</strong> möglich,
      solange deine Bestellung noch den Status „Eingereicht“ hat.</p>
    <p>Bitte teile diesen Link nicht. Er ermöglicht den Zugriff auf deine Bestellung.</p>
    <p style="font-size:12px;color:#6b7280;">Du hast keinen Link angefordert?
      Dann kannst du diese E-Mail ignorieren.</p>
  `);
  await sendMail(
    address,
    `${campaign.title}: Dein Bestelllink`,
    html,
    getEnvironment(EnvironmentVariable.SAMMELBESTELLUNG_MAIL_SENDER)
  );
}

/** Confirms the exact saved contents, rather than a subsequent concurrent edit. */
export async function sendSammelSavedMail(
  campaign: SammelAktion,
  order: SammelBestellung,
  url: string,
  firstSubmission: boolean
): Promise<void> {
  const title = firstSubmission
    ? 'Deine Bestellung ist eingegangen'
    : 'Deine Änderungen sind gespeichert';
  const items = order.items
    .map(
      (item) => `<li style="margin:0 0 16px;">
    <strong>${item.quantity} × ${escapeHtml(item.name)}</strong>
    ${item.variant ? `<br />Größe / Variante: ${escapeHtml(item.variant)}` : ''}
    <br /><span style="font-size:13px;word-break:break-all;">${
      item.reference.startsWith('https://')
        ? `<a href="${escapeHtml(item.reference)}" style="color:#003056;">${escapeHtml(item.reference)}</a>`
        : `Artikelnummer: ${escapeHtml(item.reference)}`
    }</span>
  </li>`
    )
    .join('');
  const html = mailLayout(`
    <h1 style="font-size:20px;color:#003056;">${title}</h1>
    <p>Hallo ${escapeHtml(order.name)},</p>
    <p>${firstSubmission ? 'vielen Dank für deine Bestellung!' : 'deine Bestellung wurde aktualisiert.'}
      Hier sind deine gespeicherten Angaben für <strong>${escapeHtml(campaign.title)}</strong>:</p>
    <h2 style="font-size:16px;color:#003056;margin-top:24px;">Deine Artikel</h2>
    <ul style="padding-left:20px;">${items}</ul>
    ${
      order.notes
        ? `<h2 style="font-size:16px;color:#003056;">Bemerkungen</h2>
      <p>${escapeHtml(order.notes).replace(/\r?\n/g, '<br />')}</p>`
        : ''
    }
    <p>Das Team prüft Preise und Verfügbarkeit vor der gemeinsamen Bestellung bei Rüsthaus.</p>
    ${mailButton(url, 'Meine Bestellung öffnen', 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    <p>Du kannst deine Bestellung bis <strong>${escapeHtml(formatDeadline(campaign))} Uhr (Europe/Berlin)</strong>
      bearbeiten, solange sie noch den Status „Eingereicht“ hat.</p>
    <p>Bitte teile diesen persönlichen Link nicht. Er ermöglicht den Zugriff auf deine Bestellung.</p>
  `);
  await sendMail(
    order.email,
    `${campaign.title}: ${firstSubmission ? 'Bestellung eingegangen' : 'Bestellung aktualisiert'}`,
    html,
    getEnvironment(EnvironmentVariable.SAMMELBESTELLUNG_MAIL_SENDER)
  );
}
