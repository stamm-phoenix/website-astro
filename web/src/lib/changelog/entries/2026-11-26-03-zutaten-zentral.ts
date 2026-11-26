import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-26-03-zutaten-zentral',
  date: '2026-11-26',
  title: 'Essensplanung: Zutaten in die zentrale Liste übernehmen',
  changes: [
    {
      text: 'Die zentrale Zutatenliste zeigt oben „Zutaten aus Planungen“: eigene Zutaten der Planungen, die nicht in der Liste stehen. Mit „In die Liste übernehmen“ wird eine davon eine neue Zutat der Liste oder eine, die schon drinsteht. Die Planungen nutzen danach die Zutat der Liste, ihre Mengen bleiben.',
      href: '/leitendenbereich/essensplanung-zutaten',
    },
    'Mit „Doppelte finden (KI)“ sucht die KI Zutaten der Liste, die dasselbe sind, z. B. „Zwiebel“ und „Zwiebeln“. Du wählst, welche bleibt, und legst sie mit „Zusammenlegen“ zusammen; Planungen nutzen dann die, die bleibt.',
  ],
};

export default entry;
