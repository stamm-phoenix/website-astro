import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-23-03-knoepfe-geordnet',
  date: '2026-11-23',
  title: 'Knöpfe überall wie im Protokoll angeordnet',
  changes: [
    'In vielen Bereichen stehen die Knöpfe jetzt wie im Protokoll in Zweierreihen mit gleicher Breite. Der nächste Schritt steht oben über die ganze Breite und ist als einziger Knopf gefüllt, zum Beispiel „Rückgabe erfassen“ beim Verleih, „Abschließen“ bei einem Einkauf der Essensplanung oder „Eingaben speichern“ in der Abrechnung.',
    'Selten Gebrauchtes findest du unter „⋯ Mehr“: im Postfach „Wieder neu“ und „Zuständigkeit entfernen“ für ausgewählte Mails, im Zeitplan der Abrechnung „Ablauf vom … übernehmen“ und „Tag entfernen“.',
    {
      text: 'Bei den Word-Protokollen steht im Entwurf nur noch „Zur Prüfung geben“. „Ohne Prüfung freigeben“, „Link kopieren“, „Wieder bearbeiten“ und „Löschen“ findest du unter „⋯ Mehr“.',
      href: '/leitendenbereich/protokolle',
    },
    {
      text: 'Im Blog stehen „Als Entwurf speichern“ und der nächste Schritt untereinander. Gefüllt ist, was gerade dran ist: Speichern bei Änderungen, sonst zum Beispiel „Zur Prüfung einreichen“. „Mit Rückmeldung zurückgeben“ heißt jetzt „Zurückgeben“.',
      href: '/leitendenbereich/blog',
    },
    'Neue, kürzere Namen: „Anderen zuweisen“ im Postfach, „Ausgabeliste als PDF“ und „Bestellungen als CSV“ bei den Sammelbestellungen, „Weitere hochladen“ und „In SharePoint“ nach dem Hochladen von Fotos, „Zeilen einfügen“ im Zeitplan der Abrechnung.',
    'Bei den Sammelbestellungen steht der Stand einer Bestellung jetzt über ihren Knöpfen statt unter der Artikelliste.',
  ],
};

export default entry;
