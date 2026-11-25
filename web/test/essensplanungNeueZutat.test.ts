import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getippteZutat,
  istNeueZutat,
  mitNeuerZutat,
  nurNeu,
} from '../src/lib/essensplanungGerichte.ts';
import { ergaenztText, wartendeZutaten } from '../src/components/essensplanung/zutatenErgaenzen.ts';
import {
  wirdUebernommen,
  zeileFuerSammel,
  type VorschauZeile,
} from '../src/components/essensplanung/rezeptVorschau.ts';
import type { PlanungZutat } from '../../api/lib/essen-gerichte-model.ts';
import type { PlanungAnsicht } from '../../api/lib/essen-planung-model.ts';
import type { Vorschlag } from '../src/lib/vorschlaege.ts';

/** „Zutaten schnell anlegen“: a name in neither list becomes a new ingredient of the Planung. */

const VORSCHLAEGE: Vorschlag[] = [
  { key: 'z:1', value: 'Zwiebeln', gruppe: 'Zutatenliste' },
  { key: 'z:2', value: 'Maismehl', gruppe: 'Zutatenliste' },
];

describe('the suggestion to add a new name', () => {
  test('comes last, only for a name in neither list', () => {
    const mais = mitNeuerZutat(VORSCHLAEGE, ' Mais ');
    assert.deepEqual(mais.at(-1), {
      key: 'neu',
      value: 'Mais',
      label: '„Mais“ neu anlegen',
      gruppe: 'Neue Zutat',
    });
    assert.equal(istNeueZutat(mais.at(-1)!), true);
    assert.equal(istNeueZutat(mais[0]), false);
    // A name of the list, also in other case, or a single letter gets none
    assert.deepEqual(mitNeuerZutat(VORSCHLAEGE, 'zwiebeln'), VORSCHLAEGE);
    assert.deepEqual(mitNeuerZutat(VORSCHLAEGE, 'M'), VORSCHLAEGE);
    assert.equal(getippteZutat(VORSCHLAEGE, ' zwiebeln ')?.key, 'z:1');
  });

  test('a name only counts as plainly new when nothing in the lists contains it', () => {
    assert.equal(nurNeu(VORSCHLAEGE, 'Zucchini'), true);
    // Half-typed names of the list are not new, so Enter or the button never add them by mistake
    assert.equal(nurNeu(VORSCHLAEGE, 'Zwieb'), false);
    assert.equal(nurNeu(VORSCHLAEGE, 'Mais'), false);
    assert.equal(nurNeu(VORSCHLAEGE, 'Z'), false);
  });
});

function zutat(id: number, name: string, angaben: PlanungZutat['angaben']): PlanungZutat {
  return {
    id,
    etag: '',
    zutatId: null,
    name,
    kategorieId: 1,
    einheitenart: 'masse',
    abtropfgewicht: false,
    lebensmittel: true,
    vegetarisch: null,
    vegan: null,
    allergene: [],
    abweichend: { kategorie: false, einheitenart: false },
    zeilen: 1,
    geschaeftId: null,
    angaben,
  };
}

describe('asking the AI in the background', () => {
  const ansicht = {
    zugang: 'bearbeiten',
    wartung: false,
    zutaten: [zutat(1, 'Zucchini', 'offen'), zutat(2, 'Kürbis', 'ki'), zutat(3, 'Mais', 'offen')],
  } as unknown as PlanungAnsicht;

  test('waits for open ingredients not asked about yet, only for members who may edit', () => {
    assert.deepEqual(wartendeZutaten(ansicht, new Set()), [1, 3]);
    assert.deepEqual(wartendeZutaten(ansicht, new Set([1])), [3]);
    assert.deepEqual(wartendeZutaten({ ...ansicht, zugang: 'lesen' }, new Set()), []);
    assert.deepEqual(wartendeZutaten({ ...ansicht, wartung: true }, new Set()), []);
  });

  test('names what it filled in', () => {
    assert.equal(
      ergaenztText(['Zucchini']),
      'Angaben zu Zucchini von der KI ergänzt. Prüfe sie unter „Zutaten dieser Planung“.'
    );
    assert.match(ergaenztText(['Zucchini', 'Mais']), /zu Zucchini und Mais von/);
    assert.match(ergaenztText(['A', 'B', 'C', 'D', 'E']), /zu A, B und 3 weiteren von/);
  });
});

describe('a recipe line in neither list', () => {
  const zeile: VorschauZeile = {
    an: true,
    original: '1 Hokkaido',
    zutatText: ' Hokkaido ',
    auswahl: null,
    menge: '1',
    einheit: 'stueck',
    hinweis: '',
    fuerAlles: true,
    fuerVegetarisch: true,
    fuerVegan: true,
    alternative: null,
    fehler: {},
  };

  test('is taken over as a new ingredient under its name', () => {
    assert.equal(wirdUebernommen(zeile), true);
    assert.equal(wirdUebernommen({ ...zeile, zutatText: '  ' }), false);
    const neu = zeileFuerSammel(zeile, 1);
    assert.equal('neueZutat' in neu && neu.neueZutat, 'Hokkaido');
    assert.equal(neu.menge, 1);
    const gewaehlt = zeileFuerSammel({ ...zeile, auswahl: { art: 'zentral', id: 4 } }, 1);
    assert.equal('zutatId' in gewaehlt && gewaehlt.zutatId, 4);
    assert.equal('neueZutat' in gewaehlt, false);
  });
});
