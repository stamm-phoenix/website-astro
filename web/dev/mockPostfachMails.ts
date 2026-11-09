import type { InboxNachricht, MailNachricht } from '../../api/lib/postfach-model';

/** The demo mails of the mailbox kontakt@ for `dev/mockPostfach.ts`. */

export const ADRESSE = 'kontakt@stamm-phoenix.de';

export const vor = (stunden: number): string =>
  new Date(Date.now() - stunden * 3_600_000).toISOString();

export interface DemoMail extends Omit<InboxNachricht, 'flag' | 'kategorien' | 'ordner'> {
  html: string | null;
  text: string | null;
  gesendet?: boolean;
  anhaenge?: MailNachricht['anhaenge'];
}

const erika = { name: 'Erika Muster', adresse: 'erika.muster@example.invalid' };
export const MAILS: DemoMail[] = [
  {
    id: 'AAkALgDemo0001',
    konversation: 'AAQkADemoKonv01',
    betreff: 'Schnupperstunde für Mia',
    von: erika,
    am: vor(2),
    vorschau: 'Hallo zusammen, meine Tochter Mia (8) würde gern einmal vorbeischauen …',
    hatAnhang: false,
    wichtig: false,
    html: '<p>Hallo zusammen,</p><p>meine Tochter Mia (8) würde gern einmal bei den Wölflingen vorbeischauen. Passt der kommende Freitag?</p><p>Viele Grüße<br>Erika Muster</p><p><img src="https://example.invalid/pixel.gif" width="1" height="1" alt=""></p>',
    text: null,
  },
  {
    id: 'AAkALgDemo0002',
    konversation: 'AAQkADemoKonv02',
    betreff: 'Rechnung Zeltplatz Sommerlager',
    von: { name: 'Zeltplatz am See', adresse: 'buchung@example.invalid' },
    am: vor(26),
    vorschau: 'Anbei die Rechnung für den Aufenthalt vom 1. bis 8. August.',
    hatAnhang: true,
    wichtig: true,
    html: '<p>Guten Tag,</p><p>anbei die Rechnung für den Aufenthalt vom 1. bis 8. August.</p><p>Mit freundlichen Grüßen</p>',
    text: null,
    anhaenge: [
      {
        id: 'AAMkDemoAnhang1',
        name: 'Rechnung-2026-117.pdf',
        groesse: 182_000,
        typ: 'application/pdf',
        herunterladbar: true,
      },
      {
        id: 'AAMkDemoAnhang2',
        name: 'Buchungsbestätigung',
        groesse: 24_000,
        typ: 'message/rfc822',
        herunterladbar: false,
      },
    ],
  },
  {
    id: 'AAkALgDemo0003',
    konversation: 'AAQkADemoKonv03',
    betreff: 'Frage zum Nikolausdienst',
    von: { name: 'Familie Beispiel', adresse: 'beispiel@example.invalid' },
    am: vor(80),
    vorschau: 'Kann der Nikolaus auch schon am 4. Dezember kommen?',
    hatAnhang: false,
    wichtig: false,
    html: null,
    text: 'Hallo,\n\nkann der Nikolaus auch schon am 4. Dezember kommen?\n\nDanke und Gruß',
  },
  {
    id: 'AAkALgDemo0004',
    konversation: 'AAQkADemoKonv03',
    betreff: 'AW: Frage zum Nikolausdienst',
    von: { name: 'Kontakt Stamm Phoenix', adresse: ADRESSE },
    am: vor(60),
    vorschau: 'Hallo Familie Beispiel, das klären wir gerade …',
    hatAnhang: false,
    wichtig: false,
    html: '<p>Hallo Familie Beispiel,</p><p>das klären wir gerade und melden uns.</p>',
    text: null,
    gesendet: true,
  },
  {
    id: 'AAkALgDemo0005',
    konversation: 'AAQkADemoKonv04',
    betreff: 'Newsletter Diözesanverband',
    von: { name: 'DPSG Diözese', adresse: 'newsletter@example.invalid' },
    am: vor(24 * 20),
    vorschau: 'Die Termine für das nächste Halbjahr stehen fest.',
    hatAnhang: false,
    wichtig: false,
    html: '<h2>Termine</h2><p>Die Termine für das nächste Halbjahr stehen fest.</p>',
    text: null,
  },
  {
    id: 'AAkALgDemo0006',
    konversation: 'AAQkADemoKonv05',
    betreff: 'Danke für das Sommerlager',
    von: { name: 'Familie Probe', adresse: 'probe@example.invalid' },
    am: vor(24 * 5),
    vorschau: 'Unser Sohn erzählt immer noch begeistert vom Lager.',
    hatAnhang: false,
    wichtig: false,
    html: '<p>Unser Sohn erzählt immer noch begeistert vom Lager. Danke euch allen!</p>',
    text: null,
  },
];
