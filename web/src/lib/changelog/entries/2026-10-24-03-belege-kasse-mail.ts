import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-24-03-belege-kasse-mail',
  date: '2026-10-24',
  title: 'Belege: Mail an die Kasse bei neuen Belegen',
  changes: [
    {
      text: 'Reichst du einen Beleg ein, bekommt jede Person im Team „Kasse“ eine Mail an ihre @stamm-phoenix.de-Adresse mit Geschäft, Datum, Betrag, Aktion und einem Button zu den Belegen. Das gilt auch, wenn du einen abgelehnten Beleg korrigiert erneut einreichst. So muss die Kasse nicht mehr selbst nachsehen, ob etwas Neues da ist.',
      href: '/leitendenbereich/belege',
    },
    'Lehnt die Kasse einen Beleg ab, bekommst du jetzt auch wirklich die Mail mit dem Grund.',
  ],
};

export default entry;
