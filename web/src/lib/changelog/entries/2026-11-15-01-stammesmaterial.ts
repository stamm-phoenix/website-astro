import type { ChangelogEntry } from '../../changelog';
const entry: ChangelogEntry = {
  id: '2026-11-15-01-stammesmaterial',
  date: '2026-11-15',
  title: 'Material ausleihen und mit Schildern kennzeichnen',
  changes: [
    {
      text: 'Du kannst Stammesmaterial mit mehreren Artikeln beantragen. Der Materialwart genehmigt oder lehnt die Ausleihe ab; du erhältst eine Bestätigung und die Entscheidung per E-Mail.',
      href: '/leitendenbereich/verleih',
    },
    {
      text: 'Der Materialwart erfasst die Ausgabe und auch einzelne Rückgaben. Offene Mengen, überfällige Ausleihen und Schäden bleiben sichtbar.',
      href: '/leitendenbereich/verleih',
    },
    {
      text: 'In der Inventur lädst du einzelne oder mehrere Materialschilder als PDF herunter. Der Code auf dem Schild öffnet nach der Anmeldung den passenden Artikel.',
      href: '/leitendenbereich/inventur',
    },
  ],
};
export default entry;
