import type { ChangelogEntry } from '../../changelog';
const entry: ChangelogEntry = {
  id: '2026-11-15-01-stammesmaterial',
  date: '2026-11-15',
  title: 'Material ausleihen und mit Schildern kennzeichnen',
  changes: [
    {
      text: 'Du trägst Ausleihen von Stammesmaterial direkt mit mehreren Artikeln ein und kannst sie später bearbeiten.',
      href: '/leitendenbereich/verleih',
    },
    {
      text: 'Alle Leitenden können auch einzelne Rückgaben erfassen. Offene Mengen, überfällige Ausleihen und Schäden bleiben sichtbar.',
      href: '/leitendenbereich/verleih',
    },
    {
      text: 'In der Inventur lädst du einzelne oder mehrere Materialschilder als PDF herunter. Der Code auf dem Schild öffnet nach der Anmeldung den passenden Artikel.',
      href: '/leitendenbereich/inventur',
    },
  ],
};
export default entry;
