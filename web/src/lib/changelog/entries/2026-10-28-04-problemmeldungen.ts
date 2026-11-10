import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-28-04-problemmeldungen',
  date: '2026-10-28',
  title: 'Neu: Problemmeldungen der Website sichten',
  changes: [
    {
      text: 'Besuchende können über „Problem melden“ im Footer und bei Fehleranzeigen ein Problem der Website melden. Im neuen Bereich „Problemmeldungen“ siehst du jede Meldung mit den technischen Angaben und einer automatischen Einschätzung, ob sie plausibel oder Spam ist.',
      href: '/leitendenbereich/problemmeldungen',
    },
    'Du entscheidest, was mit einer Meldung passiert: Du kannst den Entwurf für GitHub bearbeiten und die Meldung verwerfen oder an GitHub senden. Vorher siehst du, was auf GitHub landet. Ohne dein „An GitHub senden“ entsteht dort nichts.',
    'Die Mail-Adresse für Rückfragen bleibt bei der Meldung und geht nicht nach GitHub. Verworfene Meldungen werden nach 30 Tagen gelöscht, an GitHub gesendete nach 90 Tagen, offene nach 180 Tagen.',
    '„Problem melden“ findest du auch im Leitendenbereich, im Fußbereich und bei Fehleranzeigen.',
    'In der Detailansicht siehst du, wer eine Meldung zuletzt bearbeitet hat und wann.',
  ],
};

export default entry;
