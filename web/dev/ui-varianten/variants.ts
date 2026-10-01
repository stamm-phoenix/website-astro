/** A UI variant for Issue #97, applied via `<html data-ui="…">`. */
export interface UiVariant {
  id: string;
  name: string;
  tagline: string;
  fonts: string;
  /** Swatches shown in the switcher, first one is the page background. */
  swatches: string[];
}

export const UI_VARIANTS: UiVariant[] = [
  {
    id: '0',
    name: 'Basis',
    tagline: 'Ohne Varianten-Stylesheet: nur die überarbeiteten Grundstile, keine Webfonts.',
    fonts: 'Calibri / Arvo (nur falls installiert)',
    swatches: ['#f9f6f0', '#003056', '#810a1a', '#ecdfcb'],
  },
  {
    id: '1',
    name: 'Klar',
    tagline:
      'CD wörtlich und aufgeräumt: Arvo + Calibri-Klon als Webfont, drei Textfarben, Buttons füllen sich beim Antippen blau.',
    fonts: 'Arvo + Carlito (= Calibri)',
    swatches: ['#fbfaf7', '#003056', '#810a1a', '#ecdfcb'],
  },
  {
    id: '2',
    name: 'Kluft',
    tagline:
      'Sandfarbener Kluftstoff mit Gewebe, Flächen mit gesteppter Naht. Buttons wirken wie Aufnäher und werden beim Antippen dunkel.',
    fonts: 'Rokkitt (Rockwell-artig) + Source Sans 3',
    swatches: ['#ddd3c2', '#003056', '#810a1a', '#f2ebdf'],
  },
  {
    id: '3',
    name: 'Fahrtenbuch',
    tagline:
      'Hellbeige als Papier, Blau als Tinte, Rot als Stempel. Buttons werden beim Druck wie ein Stempel eingedrückt.',
    fonts: 'Zilla Slab + Carlito (= Calibri)',
    swatches: ['#ecdfcb', '#003056', '#810a1a', '#c7bdad'],
  },
  {
    id: '4',
    name: 'Wanderkarte',
    tagline:
      'Kartenpapier mit Planquadraten, Linien statt Flächen, Unterstreichungen als rote Route. Buttons füllen sich beim Antippen.',
    fonts: 'Merriweather + Source Sans 3',
    swatches: ['#fbfaf6', '#003056', '#810a1a', '#c9cfd6'],
  },
  {
    id: '5',
    name: 'Wegzeichen',
    tagline:
      'Das Gestaltungsraster aus dem CD-Leitfaden: Lilie oben links (−5°, 30 %), Wegzeichen, dynamischer Unterstrich.',
    fonts: 'Arvo + Source Sans 3 (Myriad-Familie)',
    swatches: ['#ffffff', '#003056', '#810a1a', '#ecdfcb'],
  },
];

export const UI_STORAGE_KEY = 'ui-variante';
