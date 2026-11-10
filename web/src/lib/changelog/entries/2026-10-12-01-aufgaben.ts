import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-12-01-aufgaben',
  date: '2026-10-12',
  title: 'Aufgaben für die Leitendenrunde',
  changes: [
    {
      text: 'Neues Modul „Aufgaben“: Du verteilst Aufgaben an mehrere Personen, behältst Fristen im Blick und hakst Erledigtes ab. Aufgaben gibt es als Liste und als Kanban.',
      href: '/leitendenbereich/aufgaben',
    },
    'Personen wählst du mit Namensvorschlägen aus. Aufgaben und Projekte bündeln Vorhaben, Vorlagen helfen bei wiederkehrenden Aktionen.',
    'Aus Protokollen schlägt der Leitendenbereich Aufgaben vor, die du prüfst und übernimmst. Vergangene Fristen werden dabei nicht vorgeschlagen.',
    'Du bekommst auf Wunsch Erinnerungen per E-Mail an deine Aufgaben. Auf der Startseite siehst du deine eigenen offenen Aufgaben.',
    'Wer sich für den Nikolausdienst anmeldet oder einen Link für eine Sammelbestellung anfordert, bestätigt dafür eine kurze Sicherheitsabfrage ohne Cookies.',
    {
      text: 'Die Seite „Abrechnung“ warnt, wenn du zu viele Betreuende einträgst.',
      href: '/leitendenbereich/abrechnung',
    },
  ],
};

export default entry;
