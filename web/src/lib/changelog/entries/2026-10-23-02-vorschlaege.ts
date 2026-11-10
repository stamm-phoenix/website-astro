import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-23-02-vorschlaege',
  date: '2026-10-23',
  title: 'Vorschläge beim Tippen, auch auf dem Handy',
  changes: [
    'Felder mit Vorschlägen zeigen ihre Liste jetzt direkt unter dem Feld, auch auf dem Handy. Die Liste findet dein Wort an jeder Stelle, egal ob groß oder klein geschrieben, und hebt es hervor. Du wählst per Tippen oder mit Pfeiltasten und Enter. Was nicht in der Liste steht, kannst du weiterhin einfach eintippen.',
    {
      text: 'Bei den Belegen schlagen „Ausgelegt von“ die Personen und „Aktion“ die Aktionen vor.',
      href: '/leitendenbereich/belege',
    },
    {
      text: 'Im Eigenbeleg schlägt „Aktion oder Zweck“ die Aktionen vor.',
      href: '/leitendenbereich/eigenbeleg',
    },
    {
      text: 'Bei Fragen & Antworten schlägt das Feld „Thema“ die vorhandenen Themen vor.',
      href: '/leitendenbereich/fragen-und-antworten',
    },
    {
      text: 'Im Nikolausdienst schlagen die Felder für Merkmale die schon vergebenen Merkmale vor.',
      href: '/leitendenbereich/nikolaus',
    },
    'In der Sammelbestellung schlägt die Variante eines Artikels die Varianten aus dem Katalog vor.',
  ],
};

export default entry;
