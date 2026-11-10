import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-05-05-blog-freigabe',
  date: '2026-11-05',
  title: 'Blogbeiträge zur Prüfung einreichen',
  changes: [
    'Wenn deine Anmeldung beim Prüfen abläuft, kannst du dich direkt neu anmelden. Deine Rückmeldung bleibt erhalten.',
    'Beim Speichern und Freigeben bleiben deine Eingaben geschützt. Ungesendete Rückmeldungen werden beim Verlassen berücksichtigt.',
    {
      text: 'Du kannst Blogbeiträge zur Prüfung einreichen und mit Rückmeldung zurückbekommen oder freigeben lassen. Nach der Freigabe kannst du den Beitrag veröffentlichen.',
      href: '/leitendenbereich/blog',
    },
  ],
};

export default entry;
