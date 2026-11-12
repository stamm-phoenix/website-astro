/**
 * „Gericht generieren lassen (KI)“ in the mock API: a fixed demo dish instead of a model, read
 * with the same function as the API (`api/lib/essen-ki-gericht.ts`). „KI-Fehler“ in the
 * description makes the AI answer 429 like a busy deployment; „unbekannt“ adds an ingredient
 * that is in no list.
 */
import type { KiGericht } from '../../../api/lib/essen-ki-model';
import { leseKiGericht } from '../../../api/lib/essen-ki-gericht';
import { rezeptKandidaten } from '../../../api/lib/essen-ki-rezept';
import { essenKatalog } from './essensplanung';
import { gerichteAnsicht } from './essensplanung-gerichte';
import type { MockZugang } from './essensplanung-planung';
import { MockPlanungFehler } from './essensplanung-planung';
import { MockKiBesetzt } from './essensplanung-ki';

/** A line of the demo dish for 10 people, as the model gives it. */
function zeile(name: string, menge: number | null, einheit: string | null, einheitRezept = '') {
  return {
    original: menge === null ? name : `${menge} ${einheitRezept || einheit} ${name}`,
    name,
    key: null,
    menge,
    einheit,
    einheitRezept,
    hinweis: menge === null ? 'nach Geschmack' : '',
    inhaltMenge: null,
    inhaltEinheit: null,
  };
}

export function kiGenerieren(
  z: MockZugang,
  gerichtId: number,
  beschreibung: string,
  wartung: boolean
): KiGericht {
  if (z.zugang === 'lesen')
    throw new MockPlanungFehler(
      403,
      'NUR_LESEN',
      'Mit diesem Link kannst du die Planung nur ansehen.'
    );
  if (wartung)
    throw new MockPlanungFehler(503, 'MAINTENANCE', 'Die Essensplanung wird gerade gewartet.');
  const ansicht = gerichteAnsicht(z.planung);
  const gericht = ansicht.gerichte.find((entry) => entry.id === gerichtId);
  if (!gericht) throw new MockPlanungFehler(404, 'NOT_FOUND', 'Das gibt es inzwischen nicht mehr.');
  if (/KI-Fehler/i.test(beschreibung)) throw new MockKiBesetzt();
  const personen = gericht.personen ?? 10;
  const faktor = personen / 10;
  const zeilen = [
    zeile('Nudeln (Spaghetti)', 1.5 * faktor, 'kg', 'kg'),
    zeile('Zwiebeln', 4 * faktor, 'stueck', 'Stück'),
    zeile('Knoblauch (Zehen)', 4 * faktor, 'stueck', 'Zehe'),
    zeile('Olivenöl', 3 * faktor, 'el', 'EL'),
    zeile('Paprika', 600 * faktor, 'g', 'g'),
    zeile('Salz', null, null),
    ...(/unbekannt/i.test(beschreibung)
      ? [zeile('Drachenfrucht-Pesto', 1, 'packung', 'Glas')]
      : []),
  ];
  return leseKiGericht(
    {
      rezeptPersonen: personen,
      zeilen,
      anleitung:
        '1. Wasser für die Nudeln aufsetzen und salzen.\n2. Zwiebeln und Knoblauch würfeln und im Olivenöl anschwitzen.\n3. Paprika dazugeben und 10 Minuten schmoren.\n4. Nudeln kochen, abgießen und mit dem Gemüse mischen.',
      werkzeuge: ['Großer Topf', 'Pfanne', 'Nudelsieb'],
    },
    rezeptKandidaten(essenKatalog(), ansicht.zutaten),
    gericht.personen
  );
}
