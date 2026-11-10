import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-05-09-eigenbeleg-unterschrift',
  date: '2026-11-05',
  title: 'Eigenbelege ohne Unterschrift',
  changes: [
    {
      text: 'Reichst du ein Foto eines Eigenbelegs ein, prüft die automatische Prüfung, ob du ihn unterschrieben hast. Fehlt die Unterschrift, siehst du das sofort, denn ohne Unterschrift lehnt die Kasse den Eigenbeleg ab.',
      href: '/leitendenbereich/belege',
    },
    'Die Kasse sieht in der Liste der Belege „Nicht unterschrieben“ an Eigenbelegen ohne Unterschrift.',
  ],
};

export default entry;
