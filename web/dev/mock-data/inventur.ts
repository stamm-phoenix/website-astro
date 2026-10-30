import type {
  InventarArtikel,
  InventarArtikelInput,
  InventarZaehlungInput,
} from '../../../api/lib/inventur-model';

/** The module „Inventur“ of the mock API (#107), as kept in `organisation.inventar_*`. */

const LOGIN = 'leitung@example.test';
let version = 1;
let nextId = 1;
let nextVariante = 1;

const etag = (): string => `"mock-inventur-${version++}"`;

function artikel(
  teile: Pick<InventarArtikel, 'bezeichnung' | 'kategorie' | 'lagerort'> &
    Partial<Omit<InventarArtikel, 'varianten'>> & { varianten: [string, number][] }
): InventarArtikel {
  const varianten = teile.varianten.map(([bezeichnung, bestand]) => ({
    id: nextVariante++,
    bezeichnung,
    bestand,
    gezaehltAm: null,
    gezaehltVon: null,
  }));
  return {
    id: nextId++,
    einheit: 'Stück',
    zustand: 'gut',
    zubehoer: '',
    fehlend: '',
    notizen: '',
    etag: etag(),
    updatedAt: '2026-10-01T08:00:00.000Z',
    updatedBy: LOGIN,
    ...teile,
    varianten,
    bestand: varianten.reduce((summe, v) => summe + v.bestand, 0),
  };
}

function demoData(): InventarArtikel[] {
  const pulli = artikel({
    bezeichnung: 'Stammespulli',
    kategorie: 'kleidung',
    lagerort: 'Heimkeller, Regal 1',
    varianten: [
      ['S', 4],
      ['M', 7],
      ['L', 3],
      ['XL', 0],
    ],
  });
  pulli.varianten[1].gezaehltAm = '2026-09-20T16:00:00.000Z';
  pulli.varianten[1].gezaehltVon = 'lea.leiterin@stamm-phoenix.de';
  return [
    pulli,
    artikel({
      bezeichnung: 'Aufnäher Stammeslogo',
      kategorie: 'aufnaeher',
      lagerort: 'Heimkeller, Schrank',
      varianten: [
        ['Logo klein', 25],
        ['Logo groß', 12],
      ],
    }),
    artikel({
      bezeichnung: 'Kohte',
      kategorie: 'zelt',
      lagerort: 'Zeltlager-Container',
      zustand: 'reparatur',
      zubehoer: 'Zeltbahnen, Stangen, Heringe, Spannseile',
      fehlend: '3 Heringe fehlen, eine Bahn hat einen Riss am Rand.',
      varianten: [['', 2]],
    }),
    artikel({
      bezeichnung: 'Gaskocher',
      kategorie: 'lager',
      lagerort: 'Küchenkiste',
      zustand: 'gebrauchsspuren',
      varianten: [['', 3]],
    }),
  ];
}

let data = demoData();

export function resetInventur(): void {
  version = 1;
  nextId = 1;
  nextVariante = 1;
  data = demoData();
}

export function inventurListe(): InventarArtikel[] {
  return data;
}

export function addInventarArtikel(input: InventarArtikelInput): number {
  const neu = artikel({
    ...input,
    varianten: input.varianten.map((v) => [v.bezeichnung, v.bestand]),
  });
  data.push(neu);
  return neu.id;
}

export type Ergebnis = 'ok' | 'conflict' | 'missing';

function finde(id: number, version: string): InventarArtikel | Ergebnis {
  const vorhanden = data.find((a) => a.id === id);
  if (!vorhanden) return 'missing';
  return vorhanden.etag === version ? vorhanden : 'conflict';
}

export function updateInventarArtikel(
  id: number,
  input: InventarArtikelInput,
  version: string
): Ergebnis {
  const a = finde(id, version);
  if (typeof a === 'string') return a;
  Object.assign(a, input, { etag: etag(), updatedBy: LOGIN });
  a.varianten = input.varianten.map((v) => {
    const alt = a.varianten.find((x) => x.id === v.id);
    return {
      id: alt?.id ?? nextVariante++,
      bezeichnung: v.bezeichnung,
      bestand: v.bestand,
      gezaehltAm: alt?.gezaehltAm ?? null,
      gezaehltVon: alt?.gezaehltVon ?? null,
    };
  });
  a.bestand = a.varianten.reduce((summe, v) => summe + v.bestand, 0);
  return 'ok';
}

export function zaehleInventarArtikel(
  id: number,
  input: InventarZaehlungInput,
  version: string
): Ergebnis {
  const a = finde(id, version);
  if (typeof a === 'string') return a;
  for (const v of a.varianten) {
    const gezaehlt = input.varianten.find((x) => x.id === v.id);
    if (gezaehlt) {
      v.bestand = gezaehlt.bestand;
      v.gezaehltAm = new Date().toISOString();
      v.gezaehltVon = LOGIN;
    }
  }
  a.bestand = a.varianten.reduce((summe, v) => summe + v.bestand, 0);
  a.etag = etag();
  return 'ok';
}

export function deleteInventarArtikel(id: number, version: string): Ergebnis {
  const a = finde(id, version);
  if (typeof a === 'string') return a;
  data = data.filter((x) => x.id !== id);
  return 'ok';
}
