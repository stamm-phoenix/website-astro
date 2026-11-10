import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-09-25-01-leitendenbereich',
  date: '2026-09-25',
  title: 'Der Leitendenbereich startet',
  changes: [
    'Der Leitendenbereich ist online. Du meldest dich mit deinem Konto des Stammes an, andere kommen nicht hinein.',
    {
      text: 'Die Nikolaus-Anmeldungen siehst du als Liste oder Matrix. Du kannst Familien schreiben, Termine verlegen und Anmeldungen absagen. Überbuchte Termine werden markiert.',
      href: '/leitendenbereich/nikolaus',
    },
    {
      text: 'Das Modul „CampFlow-Aktionen“ zeigt die Aktionen aus CampFlow, ohne etwas zu ändern.',
      href: '/leitendenbereich/aktionen',
    },
    {
      text: 'Gruppenstunden, Leitende, Vorstand und Downloads der Website pflegst du direkt hier. Kontaktdaten gibt es nur für den Vorstand.',
      href: '/leitendenbereich/gruppenstunden',
    },
  ],
};

export default entry;
