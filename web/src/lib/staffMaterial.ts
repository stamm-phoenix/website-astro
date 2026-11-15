import type { StaffModule } from './staffModuleTypes';

export const MATERIAL_MODULES: StaffModule[] = [
  {
    href: '/leitendenbereich/verleih',
    title: 'Verleih',
    description: 'Stammesmaterial ausleihen, Anträge prüfen und Rückgaben erfassen.',
    intro:
      'Ein Antrag reserviert noch kein Material. Erst die Genehmigung durch den Materialwart bestätigt die Ausleihe. Material mit Reparaturbedarf oder fehlenden Teilen ist gesperrt.',
    keywords: ['material', 'ausleihe', 'rückgabe', 'materialwart'],
    icon: 'M4 7h16M4 17h16M16 3l4 4-4 4M8 13l-4 4 4 4',
  },
  {
    href: '/leitendenbereich/inventur',
    title: 'Inventur',
    description:
      'Pullis, Aufnäher, Zelte und anderes Material mit Bestand, Lagerort und Zustand erfassen und zählen.',
    intro:
      'Bei Kleidung und Aufnähern hat jede Größe oder jedes Motiv einen eigenen Bestand. „Zählen“ speichert den gezählten Bestand mit Datum und deinem Namen.',
    keywords: [
      'material',
      'lager',
      'bestand',
      'zelt',
      'kohte',
      'pulli',
      'aufnäher',
      'zählen',
      'reparatur',
      'verleih',
    ],
    icon: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3.3 7.5L12 12.5l8.7-5M12 22V12.5',
  },
];
