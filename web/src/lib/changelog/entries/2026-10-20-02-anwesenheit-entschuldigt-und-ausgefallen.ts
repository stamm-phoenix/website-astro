import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-20-02-anwesenheit-entschuldigt-und-ausgefallen',
  date: '2026-10-20',
  title: 'Anwesenheit mit entschuldigten Kindern und ausgefallenen Gruppenstunden',
  changes: [
    {
      text: 'In der Anwesenheit wählst du für jedes Kind „Anwesend“, „Entschuldigt“ oder „Abwesend“. Die Auswahl wird sofort gespeichert.',
      href: '/leitendenbereich/anwesenheit',
    },
    'Fällt eine Gruppenstunde aus, markierst du sie als „Ausgefallen“. Dabei werden die Einträge der Kinder und Gäste gelöscht, und die Seite fragt vorher nach, wenn schon etwas eingetragen ist.',
    'Der Verlauf zeigt die Kinder im Schnitt pro Monat als Säulendiagramm und als Tabelle, dazu Entschuldigte, Gäste und ausgefallene Gruppenstunden. Ausgefallene Gruppenstunden zählen nicht in den Schnitt.',
    'Hat sich die Anwesenheit geändert, seit du die Seite geladen hast, lässt sich die Gruppenstunde nicht ausfallen lassen oder löschen. Die Seite sagt das, und du lädst die aktuelle Fassung.',
  ],
};

export default entry;
