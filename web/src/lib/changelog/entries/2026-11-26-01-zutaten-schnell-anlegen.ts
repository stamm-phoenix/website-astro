import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-26-01-zutaten-schnell-anlegen',
  date: '2026-11-26',
  title: 'Neue Zutaten ohne Umweg anlegen',
  changes: [
    'In der Essensplanung tippst du eine Zutat, die nicht in der Liste steht, einfach in die neue Zeile unter dem Gericht und fügst sie hinzu. Kategorie und Inhaltsstoffe musst du dafür nicht mehr vorher angeben.',
    'Stimmt dein Name mit Zutaten der Liste teilweise überein, schlägt die Liste diese zuerst vor; ganz unten steht „… neu anlegen“, wenn du wirklich eine neue Zutat meinst.',
    'Kurz danach ergänzt die KI Kategorie, Einheit, Ernährung und Allergene der neuen Zutat. Unter „Zutaten dieser Planung“ steht sie dann als „Von der KI ergänzt, ungeprüft“, bis du sie mit „Geprüft, speichern“ bestätigst.',
    'Auch beim Rezept einfügen und beim Gericht generieren kommen Zutaten, die nicht in der Liste stehen, gleich als neue Zutat mit, statt erst gewählt werden zu müssen.',
  ],
};

export default entry;
