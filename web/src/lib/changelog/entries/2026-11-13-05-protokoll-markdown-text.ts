import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-13-05-protokoll-markdown-text',
  date: '2026-11-13',
  title: 'Protokoll als ein Markdown-Text schreiben',
  changes: [
    {
      text: 'Im Protokoll-Editor gibt es unter „Texte schreiben als“ jetzt „Ein Markdown-Text“: Du schreibst die ganze Tagesordnung in ein Textfeld. „# Titel“ beginnt einen Punkt, „## Titel“ einen Unterpunkt.',
      href: '/leitendenbereich/protokolle',
    },
    'Aufgaben, Termine und das Datum eines Punkts schreibst du als eigene Zeile, zum Beispiel „Aufgabe: Zelte prüfen; zuständig: Lea; bis: 20.11.2026“. Die Syntax steht hinter dem (i) neben der Auswahl.',
    'Aktion, Projekt und offene Aufgaben des Punkts, in dem du gerade schreibst, stehen unter dem Textfeld. Dort verknüpfst du ein Projekt und hakst offene Aufgaben ab.',
    'Was sich nicht lesen lässt, etwa ein falsches Datum, steht mit der Zeilennummer unter dem Textfeld. Ein Tipp auf die Zeile springt dorthin.',
    'Die bisherige Auswahl „Einfacher Text (Markdown)“ heißt jetzt „Markdown je Punkt“.',
  ],
};

export default entry;
