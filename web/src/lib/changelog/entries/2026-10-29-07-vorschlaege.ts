import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-29-07-vorschlaege',
  date: '2026-10-29',
  title: 'Passendere Vorschläge beim Tippen',
  changes: [
    'Die Vorschläge unter einem Eingabefeld zeigen zuerst, was am besten passt: den ganzen Namen, dann was so anfängt.',
    'Essensplanung: Bei einer Zutat bleibt dein getippter Text stehen („Ol“ wird nicht mehr zu „Öl“), und Enter übernimmt den ersten Vorschlag.',
    'Essensplanung: Wer eine neue Zutat verwirft, bekommt keine falsche Meldung mehr, das Gericht sei gelöscht.',
  ],
};

export default entry;
