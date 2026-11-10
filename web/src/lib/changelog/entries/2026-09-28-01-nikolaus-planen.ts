import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-09-28-01-nikolaus-planen',
  date: '2026-09-28',
  title: 'Nikolausdienst planen und abfahren',
  changes: [
    {
      text: 'Neues Modul „Dispo“: Du verteilst die Termine eines Tages auf die Teams. Die Karte zeigt die Routen entlang der Straßen.',
      href: '/leitendenbereich/nikolaus-dispo',
    },
    {
      text: 'Neues Modul „Helfende“: Du trägst Helfende mit ihren Posten ein und teilst sie auf Teams auf. Die Einteilung ist als lesbare Liste gespeichert.',
      href: '/leitendenbereich/nikolaus-helfende',
    },
    {
      text: 'Neues Modul „Route“: Dein Team fährt die Route ab und hakt Besuche ab. Die Dispo sieht den Stand sofort.',
      href: '/leitendenbereich/nikolaus-fahrt',
    },
    'Familien sehen eine Sendungsverfolgung zu ihrem Besuch und nach dem Besuch einen Hinweis auf die Löschung ihrer Daten und das nächste Jahr.',
    'Die Anmeldung für einen Tag schließt um Mitternacht des Tages. Der Nikolausdienst hat einen eigenen Abschnitt auf der Startseite.',
  ],
};

export default entry;
