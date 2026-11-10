import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-20-03-eingaben-nach-neuer-anmeldung',
  date: '2026-10-20',
  title: 'Eingaben bleiben nach einer neuen Anmeldung erhalten',
  changes: [
    'In der iPhone-App öffnet „Neu anmelden“ keinen neuen Tab mehr, sondern meldet dich im selben Fenster neu an.',
    'Läuft deine Anmeldung ab, während ein Bearbeiten-Fenster offen ist, kommen deine Eingaben nach der neuen Anmeldung zurück. Das Fenster öffnet sich wieder, und die Felder sind ausgefüllt, auch Auswahlfelder, Zuständige bei Aufgaben und Wünsche von Helfenden.',
    {
      text: 'Bei einem Beleg sagt die Seite vor der neuen Anmeldung, dass das gewählte Foto dabei verloren gehen kann.',
      href: '/leitendenbereich/belege',
    },
  ],
};

export default entry;
