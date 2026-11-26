import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-26-06-gericht-eigene-seite',
  date: '2026-11-26',
  title: 'Essensplanung: Jedes Gericht auf einer eigenen Seite',
  changes: [
    'Unter „Gerichte“ siehst du jetzt eine Übersicht aller Gerichte. Tippst du ein Gericht an, öffnet es sich auf einer eigenen Seite mit Beschreibung, Zutaten und Anleitung, statt in der Liste aufzuklappen.',
    'Mit „Alle Gerichte“ kommst du zurück zur Übersicht. Hast du das Gericht im Plan geöffnet, bringt dich „Zurück zum Plan“ wieder an dieselbe Stelle im Plan.',
    'Jedes Gericht hat eine eigene Adresse: Der Zurück-Knopf deines Browsers funktioniert, und nach dem Neuladen bleibt das Gericht offen.',
  ],
};

export default entry;
