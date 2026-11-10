import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-07-01-protokolle-und-steuerung',
  date: '2026-10-07',
  title: 'Protokolle und Steuerung des Nikolausdienstes',
  changes: [
    {
      text: 'Neues Modul „Protokolle“: Du legst Protokolle aus der Word-Vorlage an, prüfst sie, gibst sie frei und schickst sie an alle Leitenden. Eine Vorschau zeigt das Protokoll, bevor es rausgeht.',
      href: '/leitendenbereich/protokolle',
    },
    'Das Datum der nächsten Leitendenrunde erkennt der Leitendenbereich selbst aus freigegebenen Protokollen. Du bestätigst oder lehnst es ab.',
    {
      text: 'Den Nikolausdienst steuerst du jetzt selbst unter „Steuerung“: Besuchstage und Zeiten, Anmeldung, Wartungsmodus und das Löschen der Daten nach der Saison.',
      href: '/leitendenbereich/nikolaus-steuerung',
    },
    'Blogbeiträge und Fragen & Antworten hast du jetzt auch auf der Website zum Bearbeiten: Angemeldete Leitende sehen dort Links zum Anlegen und Bearbeiten.',
  ],
};

export default entry;
