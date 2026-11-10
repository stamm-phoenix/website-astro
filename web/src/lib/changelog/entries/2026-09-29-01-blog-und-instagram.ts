import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-09-29-01-blog-und-instagram',
  date: '2026-09-29',
  title: 'Blog und Instagram auf der Startseite',
  changes: [
    {
      text: 'Neues Modul „Blog“: Du schreibst Beiträge mit Bildern und veröffentlichst sie. Blog und Instagram erscheinen gemeinsam als „Neues aus dem Stamm“ auf der Startseite, die Beiträge öffnen sich in einem Fenster.',
      href: '/leitendenbereich/blog',
    },
    'Instagram-Karussells blätterst du durch, und Reels spielen auf der Seite. Vorher fragt die Website nach, weil dabei Daten an Instagram gehen.',
    'Blogbeiträge ohne Titelbild zeigen mehr Text statt eines Platzhalters.',
    'Die Nikolaus-Schalter für den Leitendenbereich und die öffentlichen Seiten lassen sich getrennt umlegen.',
  ],
};

export default entry;
