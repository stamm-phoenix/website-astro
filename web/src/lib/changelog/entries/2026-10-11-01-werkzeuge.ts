import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-11-01-werkzeuge',
  date: '2026-10-11',
  title: 'Eigenbeleg, QR-Code und KJR-Fristen',
  changes: [
    {
      text: 'Der Eigenbeleg-Generator erstellt für Ausgaben ohne Originalbeleg ein PDF auf dem Briefpapier des Stammes.',
      href: '/leitendenbereich/eigenbeleg',
    },
    {
      text: 'Der QR-Code-Generator macht aus jedem Text einen QR-Code, auf Wunsch mit dem Phoenix oder der Lilie in der Mitte.',
      href: '/leitendenbereich/qr-code',
    },
    {
      text: 'In der Abrechnung öffnest du Einzelnachweise und änderst ihren Betrag für die aktuelle Sitzung.',
      href: '/leitendenbereich/abrechnung',
    },
    'Auf der Startseite stehen die KJR-Fristen vergangener Aktionen.',
    {
      text: 'Aufgaben liegen jetzt auch als Kanban-Tafel vor, und die Startseite zeigt deine eigenen Aufgaben. Mehr dazu steht im Eintrag vom 12. Oktober.',
      href: '/leitendenbereich/aufgaben',
    },
  ],
};

export default entry;
