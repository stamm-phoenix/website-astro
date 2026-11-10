import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-29-12-pdf-statt-drucken',
  date: '2026-10-29',
  title: 'PDF statt Drucken: Nikolausdienst und Protokolle',
  changes: [
    {
      text: 'In der Nikolaus-Dispo ersetzt „PDF herunterladen“ das Drucken. Jedes Team bekommt eine eigene Seite mit seinen Besuchen als Tabelle: Uhrzeit, Familie mit Adresse und Telefon, Versteck, Bemerkungen und Warnungen.',
      href: '/leitendenbereich/nikolaus-dispo',
    },
    {
      text: 'Die Einteilung der Nikolaus-Helfenden kannst du neben dem Bild jetzt auch als PDF herunterladen, mit einer Tabelle der Posten pro Tag und der Küche.',
      href: '/leitendenbereich/nikolaus-helfende',
    },
    'Ist der Stand noch nicht gespeichert, steht im PDF und im Bild „Entwurf, nicht gespeichert“.',
    {
      text: 'Ein Protokoll druckst du jetzt über „PDF herunterladen“ (im Entwurf und in der Prüfung „PDF-Vorschau“) unter „Prüfung und Versand“. Der Drucken-Befehl des Browsers gibt nicht mehr nur das Protokoll aus.',
      href: '/leitendenbereich/protokolle',
    },
  ],
};

export default entry;
