import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-21-10-schneller-laden',
  date: '2026-10-21',
  title: 'Seiten zeigen ihre Daten schneller',
  changes: [
    'Nach einer Pause von ein paar Minuten zeigen die Seiten ihre Daten schneller als bisher.',
    'Aktionen, Abrechnung und Anwesenheit warten seltener auf CampFlow. Hast du gerade etwas in CampFlow geändert, siehst du es hier spätestens nach einer Minute.',
    {
      text: 'Die Liste der Protokolle lädt schneller.',
      href: '/leitendenbereich/protokolle',
    },
    'Ein Protokoll im Protokoll-Editor und ein Blogbeitrag im Editor gehen schneller auf.',
    'Die Startseite zeigt deine Favoriten schneller und baut sie beim erneuten Öffnen nicht neu auf.',
    'Anwesenheit, Protokolle, Sammelbestellungen, Blog und Abrechnung zeigen beim erneuten Öffnen sofort den zuletzt geladenen Stand und holen den neuesten dahinter.',
    'Die Seiten des Nikolausdienstes und die Listen von Belegen, Aufgaben, Fragen und Blog laden schneller.',
    'Belege, Eigenbeleg, Fotos und Aufgaben laden die Aktionen aus CampFlow erst nach ihren eigenen Daten, damit die Seite schneller da ist.',
  ],
};

export default entry;
