import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-01-beleg-nachschneiden',
  date: '2026-11-12',
  title: 'Belege: kleine Fotos sind ein Hinweis statt einer Sperre',
  changes: [
    {
      text: 'Hast du ein gespeichertes Belegfoto auf einen kleinen Teil zugeschnitten, etwa einen Parkschein auf einem großen Foto, kam beim Speichern „Das Foto ist zu klein“. Jetzt wird der Ausschnitt groß genug gespeichert.',
      href: '/leitendenbereich/belege',
    },
    'Ein kleines Foto (unter 800 Pixeln an der längeren Seite) sperrt das Einreichen nicht mehr. Es steht bei den Hinweisen der Prüfung, und du entscheidest, ob alles lesbar ist. Nur ganz kleine Fotos unter 300 Pixeln gehen nicht.',
  ],
};

export default entry;
