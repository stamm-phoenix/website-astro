import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-30-01-inventur',
  date: '2026-10-30',
  title: 'Neu: Inventur für das Stammesmaterial',
  changes: [
    {
      text: 'In der Inventur erfasst du Pullis, Aufnäher, Zelte und anderes Lagermaterial mit Bestand, Lagerort und Zustand. Bei Pullis und Aufnähern trägst du den Bestand je Größe oder Motiv ein.',
      href: '/leitendenbereich/inventur',
    },
    'Du findest Material mit der Suche und filterst nach Kategorie, Lagerort und Zustand. Reparaturbedarf sowie fehlende oder beschädigte Teile stehen direkt in der Liste, bei Zelten auch das Zubehör.',
    'Mit „Zählen“ gibst du den gezählten Bestand ein; die Liste zeigt, wann und von wem zuletzt gezählt wurde. Das klappt auch direkt im Lager mit dem Handy.',
  ],
};

export default entry;
