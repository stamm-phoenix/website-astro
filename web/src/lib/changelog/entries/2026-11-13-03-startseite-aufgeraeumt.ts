import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-13-03-startseite-aufgeraeumt',
  date: '2026-11-13',
  title: 'Startseite aufgeräumt',
  changes: [
    {
      text: 'Der Hinweis auf neue Neuigkeiten passt jetzt in eine Zeile, und die Kachel „Neuigkeiten“ zeigt, wie viele du noch nicht gelesen hast.',
      href: '/leitendenbereich/neuigkeiten',
    },
    'Die Kacheln der Postfächer heißen kurz, z. B. „Kontakt“ statt „Kontakt-Postfach“, und werden nicht mehr mitten im Wort getrennt.',
    'Unter der Begrüßung steht nicht mehr, mit welcher Adresse du angemeldet bist. Das findest du weiter im Menü.',
    'Im dunklen Design ist die Lilie im Hintergrund schwächer und stört den Text nicht mehr.',
  ],
};

export default entry;
