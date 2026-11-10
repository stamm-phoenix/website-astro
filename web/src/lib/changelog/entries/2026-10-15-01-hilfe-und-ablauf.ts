import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-15-01-hilfe-und-ablauf',
  date: '2026-10-15',
  title: 'Mehr Hilfe bei Fehlern und weniger verlorene Eingaben',
  changes: [
    'Fehlermeldungen sagen dir, was nicht geklappt hat, ob etwas gespeichert wurde und wen du ansprechen kannst. Die Hilfe-Adressen sind direkt anklickbar.',
    'Läuft deine Anmeldung ab, öffnet sich die neue Anmeldung in einem neuen Tab, und dein Entwurf bleibt in der alten Seite stehen.',
    'Wenn du eine Seite mit ungespeicherten Änderungen verlässt, fragt der Leitendenbereich mit einem eigenen Fenster nach.',
    {
      text: 'Die Abrechnung merkt sich deine Eingaben pro Aktion auf dem Gerät und löscht sie einen Monat nach der KJR-Frist.',
      href: '/leitendenbereich/abrechnung',
    },
    'Ansichten und Filter heißen überall gleich und zeigen ihren Namen. Auswahlleisten sind auf dem Handy groß genug zum Antippen.',
    {
      text: 'Aktionen ohne KJR-Zuschuss lassen sich markieren.',
      href: '/leitendenbereich/aktionen',
    },
    {
      text: 'Im Protokoll-Editor sortierst du Tagesordnungspunkte per Ziehen und trägst Beginn und Ende ein.',
      href: '/leitendenbereich/protokolle',
    },
    'In der Anwesenheit steht jetzt, dass Häkchen sofort gespeichert werden.',
  ],
};

export default entry;
