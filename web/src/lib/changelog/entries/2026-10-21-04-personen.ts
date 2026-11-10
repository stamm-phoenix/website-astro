import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-21-04-personen',
  date: '2026-10-21',
  title: 'Dein Konto ist mit deiner Person in CampFlow verknüpft',
  changes: [
    {
      text: 'Aus „Weitere Personen“ wird „Personen“. Dort wird jedes Konto der Leitenden einmal mit der passenden Person in CampFlow verknüpft. Gibt es in CampFlow genau eine Person mit demselben Namen, schlägt die Seite sie vor, und du übernimmst den Vorschlag mit einem Klick.',
      href: '/leitendenbereich/personen',
    },
    'In Teilnehmendenlisten, bei Fahrten, in der Abrechnung, bei Beiträgen, Sammelbestellungen und Protokoll-Empfängern steht jetzt „(ich)“ hinter deinem eigenen Eintrag. Deine Anmeldung zu einer Aktion wird an deiner E-Mail-Adresse aus CampFlow erkannt, auch wenn du dich dort mit einem anderen Namen angemeldet hast.',
    'Altleitende und weitere Personen pflegst du wie bisher auf derselben Seite.',
  ],
};

export default entry;
