import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-18-01-navigation-und-entwuerfe',
  date: '2026-10-18',
  title: 'Neue Leiste, Berliner Zeit und sicherere Entwürfe',
  changes: [
    'Der Leitendenbereich hat eine neue Navigation: unten eine Leiste mit deinen wichtigsten Bereichen, dazu „Alle Bereiche“ mit Suche statt des Burger-Menüs. Zuletzt genutzte Bereiche bietet dir die Leiste ebenfalls an.',
    'Alle Datums- und Uhrzeitangaben richten sich nach der Berliner Zeit, auch rund um den Jahreswechsel.',
    'Wenn deine Anmeldung abläuft oder jemand anderes dasselbe bearbeitet hat, bleiben deine Eingaben erhalten. Du lädst bewusst die aktuelle Fassung nach und musst nichts neu tippen.',
    'Bei technischen Problemen nennen alle Fehlermeldungen jetzt admin@stamm-phoenix.de.',
    {
      text: 'Im Protokoll-Editor erscheinen offene Aufgaben und Projekte an den Tagesordnungspunkten. Beim Freigeben werden die Aufgaben übernommen, und das Abhaken in einem Protokoll wird mit dem Aufgabenmodul abgeglichen.',
      href: '/leitendenbereich/protokolle',
    },
    {
      text: 'Antworten in Fragen & Antworten dürfen anklickbare Links enthalten.',
      href: '/leitendenbereich/fragen-und-antworten',
    },
  ],
};

export default entry;
