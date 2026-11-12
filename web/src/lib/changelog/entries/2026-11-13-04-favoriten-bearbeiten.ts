import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-13-04-favoriten-bearbeiten',
  date: '2026-11-13',
  title: 'Favoriten auf der Startseite bearbeiten',
  changes: [
    {
      text: 'Die Kacheln unter „Deine Bereiche“ haben keinen runden Minus-Knopf mehr. Zum Entfernen tippst du neben „Deine Bereiche“ auf „Bearbeiten“; dann steht unter jedem Favoriten „Entfernen“, und „Fertig“ beendet das Bearbeiten.',
      href: '/leitendenbereich',
    },
    'Ein Favorit trägt überall denselben Stern: ausgefüllt, wenn der Bereich ein Favorit ist, sonst leer.',
    'Nach dem Entfernen erscheint kurz die Meldung mit „Rückgängig“. Ein Tipp darauf bringt den Favoriten an seinen alten Platz zurück.',
    'Langes Tippen auf eine Kachel entfernt keinen Favoriten mehr.',
  ],
};

export default entry;
