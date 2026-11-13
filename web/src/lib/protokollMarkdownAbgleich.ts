import { aufgabeZeile, terminZeile, zeitraumText } from './protokollMarkdownZeilen';
import { textImDokument } from './protokollMarkdownDokument';
import type { GelesenerPunkt } from './protokollMarkdownDokument';
import type { ProtokollAufgabe, ProtokollPunkt, PunktTermin } from './types';

/**
 * Turns the items read from the Markdown document (#613) back into `ProtokollPunkt`s. What the
 * document does not show (id, Aktion, project, open tasks) stays with the item it belongs to:
 * items are matched to the ones before by title (in order), items between two matches by
 * position, so typing a title keeps its item. An item cut out is kept aside and comes back when
 * a block with its title is pasted or the cut is undone. Untouched fields keep their stored
 * value exactly, including a text that would be written differently.
 */

/** How many removed items are kept to come back on paste or undo. */
const MAX_BEISEITE = 60;

export interface Abgleich {
  punkte: ProtokollPunkt[];
  /** Removed items, newest first; pass them to the next call. */
  beiseite: ProtokollPunkt[];
  /** The id of every item read, in reading order. */
  ids: string[];
}

function flach(punkte: ProtokollPunkt[]): ProtokollPunkt[] {
  return punkte.flatMap((punkt) => [punkt, ...punkt.unterpunkte]);
}

function titelKey(titel: string): string {
  return titel.trim().replace(/\s+/g, ' ');
}

/** Pairs of indices with the same key, as a longest common subsequence. */
function gemeinsame(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const laenge = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      laenge[i][j] =
        a[i] && a[i] === b[j]
          ? laenge[i + 1][j + 1] + 1
          : Math.max(laenge[i + 1][j], laenge[i][j + 1]);
    }
  }
  const paare: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) {
      paare.push([i, j]);
      i++;
      j++;
    } else if (laenge[i + 1][j] >= laenge[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return paare;
}

/** For each new index the old index it continues, or -1; anchors by key, gaps by position. */
function zuordnen(alt: string[], neu: string[]): number[] {
  const result = neu.map(() => -1);
  const anker = [...gemeinsame(alt, neu), [alt.length, neu.length] as [number, number]];
  let i = 0;
  let j = 0;
  for (const [ai, nj] of anker) {
    for (let k = 0; i + k < ai && j + k < nj; k++) result[j + k] = i + k;
    if (nj < neu.length) result[nj] = ai;
    i = ai + 1;
    j = nj + 1;
  }
  return result;
}

/** Keeps the ids (and untouched entries as they were) of tasks or dates. */
function eintraege<T extends { id: string }>(
  alt: T[],
  neu: Omit<T, 'id'>[],
  zeileAlt: (eintrag: T) => string,
  zeilenNeu: string[],
  newId: () => string
): T[] {
  const zuordnung = zuordnen(alt.map(zeileAlt), zeilenNeu);
  return neu.map((eintrag, index) => {
    const vorher = zuordnung[index] >= 0 ? alt[zuordnung[index]] : undefined;
    if (vorher && zeileAlt(vorher) === zeilenNeu[index]) return vorher;
    return { ...eintrag, id: vorher?.id ?? newId() } as T;
  });
}

function zusammensetzen(
  gelesen: GelesenerPunkt,
  vorher: ProtokollPunkt | undefined,
  newId: () => string
): ProtokollPunkt {
  const zeitraumGleich =
    vorher &&
    (vorher.zeitraum && (vorher.zeitraum.start || vorher.zeitraum.ende)
      ? gelesen.zeitraum !== null &&
        zeitraumText(vorher.zeitraum) === zeitraumText(gelesen.zeitraum)
      : gelesen.zeitraum === null);
  return {
    id: vorher?.id ?? newId(),
    titel:
      vorher && titelKey(vorher.titel) === titelKey(gelesen.titel) ? vorher.titel : gelesen.titel,
    aktion: vorher?.aktion ?? null,
    zeitraum: zeitraumGleich ? (vorher?.zeitraum ?? null) : gelesen.zeitraum,
    text:
      vorher && textImDokument(vorher.text) === gelesen.textImDokument ? vorher.text : gelesen.text,
    aufgaben: eintraege<ProtokollAufgabe>(
      vorher?.aufgaben ?? [],
      gelesen.aufgaben,
      aufgabeZeile,
      gelesen.aufgabeZeilen,
      newId
    ),
    termine: eintraege<PunktTermin>(
      vorher?.termine ?? [],
      gelesen.termine,
      terminZeile,
      gelesen.terminZeilen,
      newId
    ),
    projekt: vorher?.projekt ?? null,
    offeneAufgaben: vorher?.offeneAufgaben ?? [],
    unterpunkte: [],
  };
}

/** Builds the agenda from the items read; `vorher` is the agenda before this change. */
export function abgleichen(
  gelesenesDokument: GelesenerPunkt[],
  vorher: ProtokollPunkt[],
  beiseite: ProtokollPunkt[],
  newId: () => string
): Abgleich {
  // The agenda keeps one item, as in the other views; an empty document empties the first one
  const gelesen: GelesenerPunkt[] =
    gelesenesDokument.length > 0
      ? gelesenesDokument
      : [
          {
            ebene: 0,
            titel: '',
            zeitraum: null,
            textImDokument: '',
            text: '',
            aufgaben: [],
            aufgabeZeilen: [],
            termine: [],
            terminZeilen: [],
            zeile: 0,
          },
        ];
  const alt = flach(vorher);
  const zuordnung = zuordnen(
    alt.map((punkt) => titelKey(punkt.titel)),
    gelesen.map((punkt) => titelKey(punkt.titel))
  );
  const benutzt = new Set(zuordnung.filter((index) => index >= 0));
  let rest = [...beiseite];
  const quellen = gelesen.map((punkt, index): ProtokollPunkt | undefined => {
    if (zuordnung[index] >= 0) return alt[zuordnung[index]];
    // Pasted back or the cut undone: the item comes back with what the document does not show
    const key = titelKey(punkt.titel);
    const zurueck = key ? rest.find((p) => titelKey(p.titel) === key) : undefined;
    if (zurueck) rest = rest.filter((p) => p !== zurueck);
    return zurueck;
  });

  const punkte: ProtokollPunkt[] = [];
  const ids: string[] = [];
  const vergeben = new Set<string>();
  gelesen.forEach((punkt, index) => {
    const quelle = quellen[index];
    const fertig = zusammensetzen(
      punkt,
      quelle && !vergeben.has(quelle.id) ? quelle : undefined,
      newId
    );
    vergeben.add(fertig.id);
    ids.push(fertig.id);
    const hauptpunkt = punkte.at(-1);
    if (punkt.ebene === 1 && hauptpunkt) hauptpunkt.unterpunkte.push(fertig);
    else punkte.push(fertig);
  });

  const entfernt = alt
    .filter((punkt, index) => !benutzt.has(index) && !vergeben.has(punkt.id))
    .map((punkt) => ({ ...punkt, unterpunkte: [] }));
  return {
    punkte,
    beiseite: [...entfernt, ...rest].slice(0, MAX_BEISEITE),
    ids,
  };
}
