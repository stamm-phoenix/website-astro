import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-04-02-kontakt-postfach',
  date: '2026-11-04',
  title: 'E-Mails des Kontakt-Postfachs im Leitendenbereich',
  changes: [
    {
      text: 'Im neuen Bereich „E-Mail“ liest du die E-Mails an kontakt@stamm-phoenix.de, auch auf dem Handy. Die Liste zeigt alle E-Mails mit ihrem Stand. Oben filterst du nach Stand (offen oder erledigt) und Zuständigkeit (du oder niemand), beides kombinierbar, und mit „Ungelesen“ nur nach dem, was du noch nicht gelesen hast.',
      href: '/leitendenbereich/email/kontakt',
    },
    'Mit „Ich kümmere mich“ übernimmst du eine E-Mail, oder du weist sie mit „Jemandem zuweisen“ einer anderen Leitungsperson zu. Die Zuständigkeit gilt für die ganze Unterhaltung, und wer zuständig wird, bekommt eine Mail.',
    'Unter „Stand“ markierst du eine Unterhaltung als „Erledigt“ oder „Kein Handlungsbedarf“. Alle sehen dann in der Liste einen grünen Haken und wer es markiert hat. Erledigte E-Mails verschwinden aus dem Kasten auf der Startseite. Kommt danach eine neue Nachricht, ist die Unterhaltung wieder offen.',
    'Mit den Kästchen vor den E-Mails wählst du mehrere auf einmal aus und markierst sie gemeinsam als erledigt oder weist sie einer Person zu. Sie bekommt dafür eine einzige Mail.',
    'Gelesen und ungelesen gilt nur für dich: Was du hier liest, bleibt für die anderen ungelesen, und in Outlook ändert sich nichts.',
    'Antworten, Verschieben und Löschen gehen weiter in Outlook. „In Outlook öffnen“ bringt dich direkt zur E-Mail oder zum Postfach.',
    'Auf der Startseite zeigt der Kasten „E-Mails“ unter „Für dich“ ungelesene und dir zugewiesene E-Mails.',
    'Im Vorstand, im Förderverein und bei den IT-Administratoren siehst du dort außerdem das Postfach deines Teams: vorstand@, verein@ und admin@stamm-phoenix.de. Bist du gerade erst in ein Team gekommen, melde dich einmal ab und wieder an.',
  ],
};

export default entry;
