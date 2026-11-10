import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-19-01-wischen-und-beitraege',
  date: '2026-10-19',
  title: 'Wischen, Beiträge und eine neue Seitenleiste',
  changes: [
    'Auf dem Handy wischst du durch Fotos und Instagram-Bilder, ziehst das Menü und Bildansichten nach unten zum Schließen und zoomst Fotos mit zwei Fingern oder Doppeltipp.',
    'Im öffentlichen Kalender wechselst du mit einer Wischbewegung zwischen den Monaten.',
    'Am Computer gibt es eine Seitenleiste mit Suche, die du einklappen kannst. Auf dem Handy liegt eine Leiste mit deinen Favoriten unten am Rand, das Menü „Alle Bereiche“ öffnet sich darüber.',
    'Favoriten setzt du jetzt direkt am Bereich, in der Seitenleiste und im Menü, mit dem Stern oder mit langem Drücken.',
    {
      text: 'Neues Modul „Beiträge“: Es zeigt, wer für welche Aktion bezahlt hat. In der Teilnehmendenliste einer Aktion siehst du Beitrag, Zahlungsstand und Verwendungszweck, den du mit einem Klick kopierst.',
      href: '/leitendenbereich/beitraege',
    },
    'Du kannst CampFlow-Veranstaltungen, die keine echte Aktion sind (zum Beispiel Pulli-Bestellungen), als „Keine Aktion“ markieren. Sie verschwinden dann aus den Aktionslisten.',
    'Mit „Zum Inhalt springen“ überspringen Tastaturnutzende jetzt auch die Seitenleiste.',
  ],
};

export default entry;
