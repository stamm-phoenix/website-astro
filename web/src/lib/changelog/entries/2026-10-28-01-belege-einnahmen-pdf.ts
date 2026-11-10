import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-28-01-belege-einnahmen-pdf',
  date: '2026-10-28',
  title: 'Belege: Einnahmen und PDFs einreichen',
  changes: [
    {
      text: 'Du kannst jetzt auch Einnahmen einreichen, etwa eine Spende oder bar eingenommene Beiträge: Wähle beim Einreichen „Einnahme“. Die Frage, wie bezahlt wurde, fällt dann weg, und die Kasse überträgt den Beleg als Einnahme nach CampFlow.',
      href: '/leitendenbereich/belege',
    },
    'Statt eines Fotos kannst du auch ein PDF hochladen, zum Beispiel eine Rechnung, die du per Mail bekommen hast (höchstens 5 MB). Die erste Seite wird als Vorschau gezeigt, nach CampFlow geht das ganze PDF.',
  ],
};

export default entry;
