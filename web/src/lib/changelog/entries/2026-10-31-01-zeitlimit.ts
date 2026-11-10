import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-31-01-zeitlimit',
  date: '2026-10-31',
  title: 'Hängende Anfragen brechen jetzt ab',
  changes: [
    'Antwortet der Server nicht, wartet die Seite nicht mehr endlos: Nach einiger Zeit erscheint eine Meldung, und du kannst es erneut versuchen. Beim Laden von Daten versucht die Seite es vorher einmal von selbst noch einmal.',
    'Beim Speichern steht in der Meldung, dass du die Seite offen lässt und in einem neuen Tab prüfst, ob deine Änderung angekommen ist, bevor du sie noch einmal sendest.',
  ],
};

export default entry;
