import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-29-16-essensplanung-kochen',
  date: '2026-10-29',
  title: 'Essensplanung: Mahlzeiten abhaken und Lager',
  changes: [
    'Nach einer Mahlzeit hakst du jedes Gericht im Plan als gekocht oder ausgelassen ab. Beim Kochen ist die geplante Menge vorgeschlagen; du trägst ein, was wirklich verbraucht wurde, oder wählst eine Zutat als nicht verwendet ab.',
    'Abgehakte Gerichte fallen von der Einkaufsliste. Unter „Lager“ siehst du, was vom Bestand übrig ist; das zieht die Einkaufsliste ab. Das Lager gibt es auch als PDF.',
  ],
};

export default entry;
