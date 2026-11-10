import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-26-03-beitraege-erstatten',
  date: '2026-10-26',
  title: 'Beiträge: „zu erstatten“ statt „zu viel bezahlt“',
  changes: [
    {
      text: 'Wurde ein Beitrag nach dem Bezahlen gesenkt, steht er in „Meine Beiträge“ jetzt als „… bekommst du zurück“ statt „zu viel bezahlt“. Du musst dafür nichts tun, die Kasse erstattet dir den Unterschied.',
      href: '/leitendenbereich',
    },
    {
      text: 'In der Liste der Beiträge heißt derselbe Status jetzt „… zu erstatten“, passend zum Filter „Zu erstatten“.',
      href: '/leitendenbereich/beitraege',
    },
  ],
};

export default entry;
