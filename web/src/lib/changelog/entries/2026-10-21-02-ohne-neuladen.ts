import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-21-02-ohne-neuladen',
  date: '2026-10-21',
  title: 'Weniger Neuladen beim Weitergehen',
  changes: [
    {
      text: 'Nach dem Löschen eines Protokolls kommst du ohne Neuladen zurück zur Liste.',
      href: '/leitendenbereich/protokolle',
    },
    {
      text: 'Nach dem Anlegen einer Sammelbestellung geht die Seite der neuen Bestellung ohne Neuladen auf.',
      href: '/leitendenbereich/sammelbestellungen',
    },
    'Nach dem Löschen eines Blogbeitrags kommst du ohne Neuladen zurück zur Liste.',
  ],
};

export default entry;
