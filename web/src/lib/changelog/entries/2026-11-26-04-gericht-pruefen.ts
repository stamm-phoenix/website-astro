import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-26-04-gericht-pruefen',
  date: '2026-11-26',
  title: 'Essensplanung: Gericht prüfen (KI) mit Einschätzung und Zubereitung',
  changes: [
    '„Gericht prüfen (KI)“ gibt jetzt zuerst eine kurze Einschätzung, ob das Gericht mit seinen Mengen für die geplanten Personen passt. Steht eine Anleitung drin, prüft die KI auch die Zubereitung und die Werkzeuge, z. B. ob der Topf für so viele reicht. Ohne Anleitung bewertet sie die Zubereitung nicht.',
    'Hat ein Gericht keine Personenzahl, prüft die KI es für die Personen, die bei der Mahlzeit da sind, an der es eingeplant ist. Über der Einschätzung steht, für wie viele geprüft wurde.',
    'Mehr Vorschläge lassen sich mit einem Klick übernehmen: eine fehlende Zutat hinzufügen, eine Zutat austauschen oder entfernen, den Hinweis einer Zutat ändern und Werkzeuge hinzufügen, ersetzen oder entfernen.',
  ],
};

export default entry;
