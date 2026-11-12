import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-12-gericht-generieren',
  date: '2026-11-12',
  title: 'Gerichte von der KI schreiben lassen',
  changes: [
    'In der Essensplanung steht oben in jedem Gericht „Gericht generieren lassen (KI)“. Du beschreibst kurz, was es geben soll, zum Beispiel „Chili sin Carne mit Reis, mild“, und die KI schlägt das ganze Gericht vor: Personenzahl, Zutaten mit Mengen, Anleitung und Werkzeuge.',
    'Gespeichert wird erst, was du in der Vorschau prüfst und mit „Gericht übernehmen“ bestätigst. Zutaten, Mengen, Anleitung und Werkzeuge kannst du dort vorher ändern oder abwählen; eine vorhandene Anleitung wird nur ersetzt, wenn du es anhakst.',
  ],
};

export default entry;
