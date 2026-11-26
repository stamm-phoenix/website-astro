import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-26-02-zutaten-ki',
  date: '2026-11-26',
  title: 'Essensplanung: Zutaten von der KI prüfen lassen',
  changes: [
    'In „Zutaten dieser Planung“ prüft „Zutaten prüfen (KI)“ die eigenen Zutaten der Planung: Kategorie, worin sie gemessen werden, Ernährung, Allergene und die Schreibweise des Namens. „Prüfen (KI)“ an einer Zutat prüft nur diese.',
    {
      text: 'In der zentralen Zutatenliste prüft die KI alle Zutaten oder eine einzelne, dort auch die Gramm pro TL, EL und Stück.',
      href: '/leitendenbereich/essensplanung-zutaten',
    },
    'Du siehst jeden Vorschlag als „vorher → nachher“ und übernimmst ihn einzeln oder mit „Alle übernehmen“. Zutaten, mit denen die KI nichts anfangen kann, z. B. weil der Name zu umgangssprachlich ist, stehen als „Nicht verstanden“ mit einem Hinweis in der Liste.',
  ],
};

export default entry;
