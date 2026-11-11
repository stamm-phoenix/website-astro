import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-11-02-belegdialog',
  date: '2026-11-11',
  title: 'Belege: überarbeitet zum Ansehen, Bearbeiten und Prüfen',
  changes: [
    {
      text: 'Ein Beleg öffnet jetzt zum Ansehen, mit der Prüfung durch die Kasse darunter. Ändern kannst du ihn über „Bearbeiten“.',
      href: '/leitendenbereich/belege',
    },
    'Ändern dürfen einen Beleg die Kasse, der Vorstand und wer ihn eingereicht hat, solange die Kasse ihn nicht angenommen hat. Muss ein angenommener Beleg noch korrigiert werden, nimmt die Kasse die Annahme zurück.',
    'Der Vorstand sieht jetzt alle Belege.',
    'In der Liste stehen Kostenstelle und Kategorie in einer eigenen Zeile, auch in der Galerie, und du siehst, wer bezahlt und wer eingereicht hat.',
    'Findet die automatische Prüfung etwas am Foto, zeigt „Einreichen“ dir die Hinweise erst noch einmal. Eingereicht wird, wenn du sie bestätigst.',
    'Ein Beleg öffnet erst, wenn sein Foto geladen ist; bis dahin steht „Beleg wird geöffnet …“ da.',
    'Auf großen Bildschirmen steht das Foto eines Belegs jetzt links neben seinen Angaben, beide lassen sich für sich scrollen.',
    'Beim Zuschneiden kannst du zwischen „Frei“ (jede Ecke einzeln ziehen) und „Rechteck“ wählen. Das Rechteck verschiebst du als Ganzes, an seinen Ecken und Seiten änderst du die Größe.',
    'Das Foto zum Zuschneiden ist wieder groß, und unter dem Foto stehen weniger Knöpfe: Öffnen und Herunterladen sind Links, „Anderes Foto oder PDF wählen“ steht daneben.',
    'Unter „Wie wurde bezahlt?“ gibt es statt „Mit meinem Geld“ und „Jemand anderes“ nur noch „Privat ausgelegt“. Bei einem neuen Beleg steht dein Name schon unter „Ausgelegt von“, du kannst ihn ändern.',
    'Der Belegdialog verrutscht beim Scrollen nicht mehr, sodass Überschrift und Knöpfe an ihrem Platz bleiben.',
  ],
};

export default entry;
