import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-28-03-essensplanung-steuerung',
  date: '2026-10-28',
  title: 'Essensplanung: Steuerung für Admins und Vorstand',
  changes: [
    {
      text: 'Für die kommende Essensplanung gibt es eine Steuerung. Admins und Vorstand legen dort fest, ob auch Menschen außerhalb des Stammes Planungen anlegen dürfen, mit welchen Gruppen und Mahlzeiten eine neue Planung startet und wie lange Planungen aufbewahrt werden.',
      href: '/leitendenbereich/essensplanung-steuerung',
    },
    'Dort pflegt ihr auch die Zutatenliste, die alle Planungen teilen. Sie startet mit über 400 Zutaten aus der Küche des Bezirkslagers. Ob eine Zutat vegetarisch oder vegan ist und welche Allergene sie enthält, ist vorerst nur ein Vorschlag: Prüft die Einträge mit dem Filter „Nur ungeprüfte“ und hakt sie als geprüft ab.',
  ],
};

export default entry;
