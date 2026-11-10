import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-29-18-essensplanung-ki',
  date: '2026-10-29',
  title: 'Essensplanung: KI hilft bei Gerichten',
  changes: [
    '„Gericht prüfen“ lässt die KI schauen, ob Mengen zur Personenzahl passen, ob Häkchen für vegetarisch, vegan und Unverträglichkeiten stimmen, ob sich ein Tippfehler eingeschlichen hat oder eine Zutat fehlt. Einen Vorschlag zu Menge oder Häkchen übernimmst du mit einem Klick.',
    '„Rezept einfügen“: Du fügst ein Rezept als Text ein, die KI liest die Zutaten, ordnet sie der Zutatenliste zu und rechnet auf die Personen des Gerichts um. Du prüfst die Liste, wählst Zeilen ab oder änderst sie, erst dann wird etwas übernommen.',
    'Fehlt in der Zutatenliste das Gewicht für einen Teelöffel, Esslöffel oder ein Stück, kann die KI es im Dialog der Zutat schätzen. Die Schätzung ist als solche gekennzeichnet.',
    'Ist die KI gerade ausgelastet, sagt die Seite das und wann du es wieder versuchen kannst; alles andere funktioniert weiter.',
  ],
};

export default entry;
