import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-02-04-beleg-pdf-seiten',
  date: '2026-11-02',
  title: 'Mehrseitige PDF-Belege',
  changes: [
    {
      text: 'Lädst du einen Beleg als PDF mit mehreren Seiten hoch, siehst du jetzt im Formular und später in der Ansicht des Belegs bis zu 20 Seiten statt nur der ersten. Geschäft, Datum und Betrag werden aus bis zu fünf Seiten gelesen, bei längeren PDFs aus den ersten vier und der letzten, wo meist die Summe steht. An CampFlow geht wie bisher das ganze PDF. Foto und Seiten nutzen im Dialog jetzt die ganze Breite, damit du den Beleg besser lesen kannst. Das gilt auch für die Belege in der Essensplanung.',
      href: '/leitendenbereich/belege',
    },
  ],
};

export default entry;
