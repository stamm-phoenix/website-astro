import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-08-01-anwesenheit-und-fahrten',
  date: '2026-10-08',
  title: 'Anwesenheit und Fahrten planen',
  changes: [
    {
      text: 'Neues Modul „Anwesenheit“: Du hakst bei jeder Gruppenstunde ab, wer da ist. Die Liste zeigt nur aktuelle CampFlow-Mitglieder, und vergangene Termine behalten ihren Namen im Verlauf.',
      href: '/leitendenbereich/anwesenheit',
    },
    {
      text: 'Neues Modul „Fahrten“: Du planst Fahrgemeinschaften für Aktionen. Leitende, die Plätze anbieten, fahren selbst, Geschwister und Leitende sitzen möglichst zusammen, und von Hand gesetzte Personen bleiben an ihrem Platz.',
      href: '/leitendenbereich/aktionen/fahrten',
    },
    'Fällt CampFlow aus, bekommst du eine klare Meldung statt einer Fehlerseite.',
    'Nikolausdienst, Blog und Fragen & Antworten liegen jetzt in einer Datenbank. Der Betrieb ist für dich unverändert.',
  ],
};

export default entry;
