import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-11-02-belegdialog',
  date: '2026-11-11',
  title: 'Belege: Foto neben den Angaben, rechteckig zuschneiden',
  changes: [
    {
      text: 'Auf großen Bildschirmen steht das Foto eines Belegs jetzt links neben seinen Angaben, beide lassen sich für sich scrollen.',
      href: '/leitendenbereich/belege',
    },
    'Beim Zuschneiden kannst du zwischen „Frei“ (jede Ecke einzeln ziehen) und „Rechteck“ wählen. Das Rechteck verschiebst du als Ganzes, an seinen Ecken und Seiten änderst du die Größe.',
    'Das Foto zum Zuschneiden ist wieder groß, und unter dem Foto stehen weniger Knöpfe: Öffnen und Herunterladen sind Links, „Anderes Foto oder PDF wählen“ steht daneben.',
    'Unter „Wie wurde bezahlt?“ gibt es statt „Mit meinem Geld“ und „Jemand anderes“ nur noch „Privat ausgelegt“. Bei einem neuen Beleg steht dein Name schon unter „Ausgelegt von“, du kannst ihn ändern.',
    'Der Belegdialog verrutscht beim Scrollen nicht mehr, sodass Überschrift und Knöpfe an ihrem Platz bleiben.',
  ],
};

export default entry;
