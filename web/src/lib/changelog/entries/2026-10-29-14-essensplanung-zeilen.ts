import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-29-14-essensplanung-zeilen',
  date: '2026-10-29',
  title: 'Essensplanung: Zutaten wie in einer Tabelle',
  changes: [
    'Menge, Einheit und Hinweis einer Zutat änderst du direkt in der Zeile; gespeichert wird, wenn du die Zeile verlässt oder Enter drückst.',
    'Neue Zutaten tippst du in die leere Zeile unter dem Gericht. Enter fügt sie hinzu, und du kannst gleich die nächste eintragen. Für wen eine Zutat ist und Unverträglichkeiten stehen weiter unter „Mehr Angaben …“ und „Ändern“.',
  ],
};

export default entry;
