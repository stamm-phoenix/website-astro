import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-22-01-teams',
  date: '2026-10-22',
  title: 'Zugang über die Teams in Microsoft Teams, Belege freigeben nur für die Kasse',
  changes: [
    'Der Leitendenbereich ist jetzt nur noch für Mitglieder des Teams „Leitende“ in Microsoft Teams offen. Siehst du nach dem Update „Kein Zugang“, melde dich einmal ab und wieder an.',
    {
      text: 'Belege annehmen, ablehnen und nach CampFlow übertragen kann nur noch das Team „Kasse“. Alle anderen reichen ihre Belege ein, korrigieren sie und sehen ihren Stand wie bisher.',
      href: '/leitendenbereich/belege',
    },
    'Kommst du neu in ein Team, gilt das ab deiner nächsten Anmeldung.',
  ],
};

export default entry;
