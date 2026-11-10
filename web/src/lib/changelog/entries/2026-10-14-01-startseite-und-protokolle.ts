import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-14-01-startseite-und-protokolle',
  date: '2026-10-14',
  title: 'Neue Startseite, Protokoll-Editor und Aufgaben im Menü',
  changes: [
    'Die Startseite ist kompakter. Die Bereiche sind nach dem sortiert, was Leitende dort tun: Leitendenrunde, Gruppen & Aktionen, Kasse & Material und Website pflegen.',
    'Im Kopf jeder Seite findest du Menü, Abmelden und Hilfe-Adressen. Der Abmelden-Knopf fragt vorher nach.',
    {
      text: 'Du schreibst die Protokolle der Leitendenrunde direkt im Protokoll-Editor, mit Terminen, Markdown, Vorschau und Personenauswahl. Das Protokoll wird als PDF mit Deckblatt und Inhaltsverzeichnis abgelegt, geprüft und verschickt.',
      href: '/leitendenbereich/protokolle',
    },
    'Mit der Präsentation zeigst du ein Protokoll groß und gut lesbar auf dem Fernseher oder in der Bildschirmfreigabe.',
    'Die Anwesenheit hat ein eigenes Symbol. Dialoge und Seitenwechsel fragen nach, bevor ungespeicherte Eingaben verloren gehen, und die Einteilung des Nikolausdienstes fragt vor dem Wechsel der Ansicht.',
    'Alle Lade- und Fehlerzustände sehen gleich aus und bieten „Erneut versuchen“ an.',
    'Das Modul „Mitschriften“ ist wieder entfernt.',
  ],
};

export default entry;
