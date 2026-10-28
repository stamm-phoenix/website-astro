import { CONFIG } from './config';
import { escapeHtml, sendMail } from './mail';
import { mailButton, mailLayout } from './mail-template';

/**
 * Mails of the Essensplanung: confirmation of a new Planung, invitation, the links of „Meine
 * Planungen“ and the warning before a Planung is deleted. All go out from
 * `CONFIG.essensplanung.sender`; PR previews send none and show the link on the page instead.
 */

/** Sending, as an object so tests can replace it. */
export const essenMail = {
  async send(to: string, subject: string, html: string): Promise<void> {
    await sendMail(to, subject, html, CONFIG.essensplanung.sender, undefined, {
      timeoutMs: 15_000,
    });
  },
};

const FUSS = `<p style="font-size:13px;color:#4b5563;">Die Essensplanung ist ein Werkzeug des DPSG Stammes Phoenix für Küchenteams von Aktionen. Der Link ist dein persönlicher Zugang: Gib ihn nicht weiter. Andere lädst du in der Planung unter „Mitglieder“ ein.</p>`;

export function bestaetigungMail(name: string, planungName: string, link: string) {
  return {
    subject: `Essensplanung „${planungName}“ anlegen`,
    html: mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Hallo ${escapeHtml(name)},</h1>
    <p>du möchtest in der Essensplanung die Planung <strong>${escapeHtml(planungName)}</strong> anlegen. Bestätige das mit dem Knopf; der Link gilt 24 Stunden.</p>
    ${mailButton(link, 'Planung anlegen', 'Falls der Knopf nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    <p style="font-size:13px;color:#4b5563;">Warst du das nicht, kannst du diese Mail einfach löschen; ohne Bestätigung wird nichts angelegt.</p>`),
  };
}

export function einladungMail(name: string, planungName: string, einladend: string, link: string) {
  return {
    subject: `Einladung zur Essensplanung „${planungName}“`,
    html: mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Hallo ${escapeHtml(name)},</h1>
    <p>${escapeHtml(einladend)} hat dich zur Essensplanung <strong>${escapeHtml(planungName)}</strong> eingeladen. Mit dem Knopf öffnest du die Planung und kannst mitplanen.</p>
    ${mailButton(link, 'Planung öffnen', 'Falls der Knopf nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    ${FUSS}`),
  };
}

export function neuerLinkMail(name: string, planungName: string, link: string) {
  return {
    subject: `Dein neuer Link zur Essensplanung „${planungName}“`,
    html: mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Hallo ${escapeHtml(name)},</h1>
    <p>hier ist dein neuer Link zur Essensplanung <strong>${escapeHtml(planungName)}</strong>. Dein bisheriger Link funktioniert nicht mehr.</p>
    ${mailButton(link, 'Planung öffnen', 'Falls der Knopf nicht funktioniert, kopiere diese Adresse in deinen Browser:')}
    ${FUSS}`),
  };
}

export function meinePlanungenMail(eintraege: { planungName: string; link: string }[]) {
  const liste = eintraege
    .map(
      (eintrag) =>
        `<li style="margin:0 0 12px;"><a href="${escapeHtml(eintrag.link)}" style="color:#003056;font-weight:bold;">${escapeHtml(eintrag.planungName)}</a></li>`
    )
    .join('');
  return {
    subject: 'Deine Essensplanungen',
    html: mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Deine Essensplanungen</h1>
    <p>Hier sind neue Links zu allen Planungen, in denen du mit dieser Adresse Mitglied bist. Die bisherigen Links funktionieren nicht mehr.</p>
    <ul style="padding-left:20px;">${liste}</ul>
    ${FUSS}`),
  };
}

export function loeschwarnungMail(name: string, planungName: string, loeschtAm: string) {
  const datum = new Date(`${loeschtAm}T12:00:00Z`).toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  });
  return {
    subject: `Essensplanung „${planungName}“ wird am ${datum} gelöscht`,
    html: mailLayout(`
    <h1 style="font-size:20px;color:#003056;margin:0 0 16px;">Hallo ${escapeHtml(name)},</h1>
    <p>die Essensplanung <strong>${escapeHtml(planungName)}</strong> wird am <strong>${datum}</strong> mit allen Daten gelöscht, weil ihre Aufbewahrungszeit endet.</p>
    <p>Willst du etwas behalten, öffne die Planung vorher über deinen Link und drucke oder speichere die Seiten, die du brauchst.</p>
    <p style="font-size:13px;color:#4b5563;">Den Link findest du in deinen bisherigen Mails oder auf der Seite „Essensplanung“ unter „Meine Planungen“.</p>`),
  };
}
