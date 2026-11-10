import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-17-01-textfelder',
  date: '2026-10-17',
  title: 'Ein Editor für alle Textfelder',
  changes: [
    'Alle längeren Textfelder (Blog, Protokolle, Beschreibungen) nutzen denselben Editor mit Überschriften, Listen, Tabellen und Checklisten.',
    {
      text: 'Im Protokoll wählst du, ob du formatiert oder in Markdown schreibst. Deine Wahl gilt auf allen Geräten.',
      href: '/leitendenbereich/protokolle',
    },
    {
      text: 'Die Tagesordnung eines Protokolls ist ein einziges Dokument. Du kannst Punkte darin verschieben, kopieren und mit Rückgängig zurücknehmen.',
      href: '/leitendenbereich/protokolle',
    },
    'Breite Tabellen sagen dir, dass sie seitlich scrollen. Checklisten-Kästchen lassen sich auf dem Handy gut treffen.',
  ],
};

export default entry;
