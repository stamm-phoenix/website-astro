import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-11-12-09-protokoll-aktionen',
  date: '2026-11-12',
  title: 'Protokolle: Knöpfe übersichtlicher angeordnet',
  changes: [
    {
      text: 'Im Protokoll stehen die Knöpfe jetzt in Zweierreihen. Oben steht der Status neben „Bearbeiten“, darunter der nächste Schritt über die ganze Breite: im Entwurf „Zur Prüfung geben“, in der Prüfung „Freigeben“ und „Zurückgeben“, danach „Protokoll verschicken“.',
      href: '/leitendenbereich/protokolle',
    },
    'Darunter folgen „PDF-Vorschau“ und „Präsentation“ sowie „Korrekturen prüfen“. Daneben steht „Versionen“. Im Entwurf findest du dort stattdessen „Mehr“ mit „Versionen“ und „Ohne Prüfung freigeben“.',
    '„Mitlesen“ ist jetzt ein Schalter unter den Knöpfen und zeigt, ob es an oder aus ist.',
  ],
};

export default entry;
