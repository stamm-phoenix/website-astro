import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-06-protokoll-erwaehnungen',
  date: '2026-11-12',
  title: 'Leute im Protokoll mit @ erwähnen',
  changes: [
    {
      text: 'Tippst du im Text eines Tagesordnungspunkts @ und den Anfang eines Namens, schlägt der Editor passende Personen vor. Mit Enter, Tab oder einem Klick fügst du die Erwähnung ein. Sie erscheint hervorgehoben in der Ansicht, in der Präsentation und im PDF.',
      href: '/leitendenbereich/protokolle',
    },
    'Sobald das Protokoll freigegeben ist, bekommt jede erwähnte Person eine Mail mit den Punkten, in denen sie steht, und einem Link aufs Protokoll. Die Mail geht auch an ihre Adresse aus CampFlow, wenn ihr Konto unter „Personen“ verknüpft ist.',
  ],
};

export default entry;
