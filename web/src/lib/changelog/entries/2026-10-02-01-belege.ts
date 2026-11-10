import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-02-01-belege',
  date: '2026-10-02',
  title: 'Kassenbelege einreichen',
  changes: [
    {
      text: 'Neues Modul „Belege“: Du fotografierst einen Kassenbeleg und reichst ihn ein. Die Kasse prüft ihn und überträgt angenommene Belege nach CampFlow.',
      href: '/leitendenbereich/belege',
    },
    'Eine Scan-Funktion macht aus dem Foto ein lesbares Bild. Eine automatische Vorprüfung meldet Auffälliges wie Alkohol, Tabak oder nicht jugendfreie Artikel, bevor die Kasse entscheidet.',
  ],
};

export default entry;
