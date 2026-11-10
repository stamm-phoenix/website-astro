import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-01-01-sammelbestellungen',
  date: '2026-10-01',
  title: 'Sammelbestellungen',
  changes: [
    {
      text: 'Neues Modul „Sammelbestellungen“: Du sammelst Rüsthaus-Bestellungen, lädst Mitglieder ein und exportierst die Bestellliste.',
      href: '/leitendenbereich/sammelbestellungen',
    },
    'Häufig bestellte Artikel des Stammes stehen schon im Katalog. Abgeschlossene Bestellungen zeigen eine kompakte Ansicht.',
    'Zahlungen verfolgst du per Hand oder über CampFlow. Der Zuschuss für Aktionen wird mit der Kostenstelle der Sammlung verbucht.',
  ],
};

export default entry;
