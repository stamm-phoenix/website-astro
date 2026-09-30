import { EnvironmentVariable, getEnvironment } from './environment';
import { escapeHtml, sendMail } from './mail';
import { mailLayout, mailButton } from './mail-template';
import type { SammelAktion } from './sammelbestellung-model';

export async function sendSammelLinkMail(
  address: string,
  campaign: SammelAktion,
  url: string
): Promise<void> {
  const deadline = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(campaign.endsAt));
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
