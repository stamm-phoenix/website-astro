import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-11-erwaehnungen-korrekturen',
  date: '2026-11-12',
  title: 'Erwähnungen im Protokoll: zwei Korrekturen',
  changes: [
    {
      text: 'Auf dem Handy passt die Personenliste beim Erwähnen mit @ jetzt ganz auf den Bildschirm, auch wenn das @ weit rechts steht.',
      href: '/leitendenbereich/protokolle',
    },
    'Schreibst du im Markdown-Modus und gehst mit den Pfeiltasten nach links oder rechts aus dem @-Wort heraus, schließt sich die Liste. Enter fügt dann keine Erwähnung mehr an der falschen Stelle ein.',
  ],
};

export default entry;
