import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-02-protokoll-korrekturen',
  date: '2026-11-12',
  title: 'Protokolle: Korrekturvorschläge auf Knopfdruck',
  changes: [
    {
      text: 'Ist ein Protokoll fertig geschrieben, findest du unter „Prüfung und Versand“ den Knopf „Auf Korrekturen prüfen“. Du bekommst Vorschläge zu Rechtschreibung, unklaren Sätzen und uneinheitlichen Schreibweisen sowie Rückfragen, etwa zu Aufgaben ohne Zuständige oder Termine ohne Datum.',
      href: '/leitendenbereich/protokolle',
    },
    'Jeden Vorschlag übernimmst oder verwirfst du einzeln, Rechtschreibkorrekturen auch alle auf einmal. Am Protokoll ändert sich nur, was du übernimmst, und die Fassung davor kannst du über „Versionen“ zurückholen.',
    'Hat sich eine Stelle inzwischen geändert, steht beim Vorschlag „Text hat sich geändert“ und er lässt sich nicht mehr übernehmen. Freigegebene Protokolle bleiben unverändert.',
  ],
};

export default entry;
