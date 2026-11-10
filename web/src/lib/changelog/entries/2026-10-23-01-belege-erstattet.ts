import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-23-01-belege-erstattet',
  date: '2026-10-23',
  title: 'Belege: Erstattungsdatum und kürzere Liste „Meine Belege“',
  changes: [
    {
      text: 'Bei Belegen aus CampFlow steht jetzt, wann sie erstattet oder bezahlt wurden, z. B. „Erstattet am 25.06.2026“, in der Liste, in der Galerie und in den Details.',
      href: '/leitendenbereich/belege',
    },
    '„Meine Belege“ auf der Startseite zeigt nur noch Belege, die noch nicht erstattet sind, und die in den letzten 30 Tagen erstatteten. Ältere findest du in den Belegen mit „Nur meine Belege“.',
  ],
};

export default entry;
