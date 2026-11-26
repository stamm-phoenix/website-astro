import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-26-01-eigene-zutaten',
  date: '2026-11-26',
  title: 'Essensplanung: eigene Zutaten nur mit Namen',
  changes: [
    'Steht eine Zutat nicht in der Liste, trägst du in der neuen Zeile eines Gerichts einfach Name, Menge und Einheit ein: Sie wird beim Hinzufügen zur eigenen Zutat der Planung. Kategorie, Ernährung und Allergene kannst du später festlegen; bis dahin steht in „Zutaten dieser Planung“ „Angaben fehlen“.',
    'Zutaten, die kein Gericht, kein Bestand, kein Zusatzbedarf und kein Einkauf mehr nutzt, verschwinden von selbst aus „Zutaten dieser Planung“.',
  ],
};

export default entry;
