import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-04-einteilung-kacheln',
  date: '2026-11-12',
  title: 'Nikolaus-Einteilung mit Personenkacheln',
  changes: [
    {
      text: 'In der Einteilung der Helfenden ist jede Person jetzt eine Kachel pro Tag, auf der steht, wofür sie sich gemeldet hat. Du ziehst die Kachel auf einen Posten oder tippst sie an und wählst beim Posten „Hierher“. Liegt dort schon jemand, tauschen die beiden die Plätze, wenn das passt.',
      href: '/leitendenbereich/nikolaus-helfende',
    },
    {
      text: 'Mit der Stecknadel in der Kachel hältst du eine Person auf ihrem Posten fest: Sie lässt sich dann nicht mehr verschieben, und „Neu berechnen“ lässt sie dort. Von Hand gesetzte Personen werden nicht mehr von selbst festgehalten.',
      href: '/leitendenbereich/nikolaus-helfende',
    },
    'Oben an jedem Tag steht die Box „Ohne Posten“: Wer dort liegt, macht an dem Tag nichts, auch nicht in der Küche, und „Neu berechnen“ lässt die Person dort. Lässt du eine Kachel aus einem Posten irgendwo auf der Seite los, landet sie ebenfalls dort. Die Küche hat unten einen eigenen Bereich zum Hineinziehen.',
    'Jede Kachel zeigt, wie oft die Person über alle Tage im Einsatz ist, insgesamt und je Posten (zum Beispiel „Nikolaus 2x“), die Küche mitgezählt. Unten zeigt „Einsätze pro Person“ dasselbe als Tabelle, damit du die Verteilung vergleichen kannst.',
  ],
};

export default entry;
