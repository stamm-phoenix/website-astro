import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-09-01-postfach-outlook',
  date: '2026-11-09',
  title: 'E-Mail: Stand und Zuständigkeit auch in Outlook',
  changes: [
    {
      text: 'Jede E-Mail ist jetzt „Neu“, „Handlungsbedarf“ oder „Erledigt“. Neue E-Mails stehen bei allen auf der Übersicht, bis jemand entscheidet. Mit „Handlungsbedarf“ erinnern sie die zuständige Person, oder alle, solange niemand zuständig ist.',
      href: '/leitendenbereich/email/kontakt',
    },
    'Stand und Zuständigkeit stehen auch in Outlook: „Handlungsbedarf“ ist ein Fähnchen, „Erledigt“ heißt archiviert und die zuständige Person ist eine Kategorie mit 👤 vor dem Namen. Was du in Outlook tust, siehst du hier, und umgekehrt. Archivierst du in Outlook, ist die E-Mail erledigt.',
    'Wer zuständig wird, macht aus einer neuen E-Mail „Handlungsbedarf“. Kommt nach „Erledigt“ eine Antwort, ist die E-Mail wieder neu.',
    '„Kein Handlungsbedarf“ gehört jetzt zu „Erledigt“. Gelesen und ungelesen gibt es hier nicht mehr, weil es nur zeigte, wer eine E-Mail schon angeklickt hatte. Änderst du hier Stand oder Zuständigkeit, ist die E-Mail in Outlook als gelesen markiert.',
  ],
};

export default entry;
