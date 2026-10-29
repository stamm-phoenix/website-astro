/**
 * The AI of the Essensplanung in the mock API: deterministic answers instead of a model, read
 * with the same functions as the API (`api/lib/essen-ki-model.ts`, `essen-ki-rezept.ts`), and
 * the batch of recipe lines. „KI-Fehler“ in the name of a dish or in a recipe makes the AI
 * answer 429 with `Retry-After`, as a busy deployment does.
 */
import type { GerichtZutatInput } from '../../../api/lib/essen-gerichte-validation';
import { MAX_ZEILEN_PRO_GERICHT } from '../../../api/lib/essen-gerichte-model';
import type {
  KiMass,
  KiPruefung,
  KiRezept,
  KiUmrechnung,
  KiZutatWahl,
} from '../../../api/lib/essen-ki-model';
import { leseKiPruefung, leseKiUmrechnung } from '../../../api/lib/essen-ki-model';
import { leseKiRezept, rezeptKandidaten } from '../../../api/lib/essen-ki-rezept';
import { essenKatalog } from './essensplanung';
import { gerichteAnsicht, gerichtZutatAnlegen } from './essensplanung-gerichte';
import type { MockZugang } from './essensplanung-planung';
import { MockPlanungFehler, aendere } from './essensplanung-planung';

/** The deployment is busy; the mock answers 429 with this `Retry-After`. */
export class MockKiBesetzt extends Error {
  readonly retryAfter = 30;
  readonly message = `KI gerade nicht verfügbar, bitte in etwa ${this.retryAfter} Sekunden noch einmal versuchen. Alles andere funktioniert wie gewohnt.`;
}

const FEHLER = /KI-Fehler/i;

function pruefeZugang(z: MockZugang, wartung: boolean): void {
  if (z.zugang === 'lesen')
    throw new MockPlanungFehler(
      403,
      'NUR_LESEN',
      'Mit diesem Link kannst du die Planung nur ansehen.'
    );
  if (wartung)
    throw new MockPlanungFehler(503, 'MAINTENANCE', 'Die Essensplanung wird gerade gewartet.');
}

function gerichtVon(z: MockZugang, id: number) {
  const ansicht = gerichteAnsicht(z.planung);
  const gericht = ansicht.gerichte.find((entry) => entry.id === id);
  if (!gericht) throw new MockPlanungFehler(404, 'NOT_FOUND', 'Das gibt es inzwischen nicht mehr.');
  return { gericht, zutaten: ansicht.zutaten };
}

/**
 * Hints as a model might give them: the first amount seems low (proposing twice as much), meat
 * on a vegetarian line, and maybe salt is missing.
 */
export function kiPruefen(z: MockZugang, gerichtId: number, wartung: boolean): KiPruefung {
  pruefeZugang(z, wartung);
  const { gericht, zutaten } = gerichtVon(z, gerichtId);
  if (FEHLER.test(gericht.name)) throw new MockKiBesetzt();
  const nachId = new Map(zutaten.map((zutat) => [zutat.id, zutat]));
  const leer = {
    menge: null,
    einheit: null,
    fuerAlles: null,
    fuerVegetarisch: null,
    fuerVegan: null,
  };
  const hinweise: unknown[] = [];
  const erste = gericht.zutaten.findIndex((zeile) => zeile.menge !== null);
  if (erste >= 0) {
    const zeile = gericht.zutaten[erste];
    hinweise.push({
      ...leer,
      art: 'menge',
      zeile: erste + 1,
      text: `Die Menge wirkt für ${gericht.personen} Personen knapp.`,
      vorschlag: 'Etwa doppelt so viel einplanen.',
      menge: zeile.menge! * 2,
      einheit: zeile.einheit,
    });
  }
  gericht.zutaten.forEach((zeile, index) => {
    if (zeile.fuerVegetarisch && nachId.get(zeile.planungZutatId)?.vegetarisch === false)
      hinweise.push({
        ...leer,
        art: 'ernaehrung',
        zeile: index + 1,
        text: 'Die Zutat ist nicht vegetarisch, die Zeile gilt aber für vegetarisch Essende.',
        vorschlag: 'Nur für „mit allem“ und eine vegetarische Ersatzzeile anlegen.',
        fuerVegetarisch: false,
        fuerVegan: false,
      });
  });
  hinweise.push({
    ...leer,
    art: 'fehlt',
    zeile: null,
    text: 'Salz fehlt vielleicht.',
    vorschlag: 'Salz nach Geschmack ergänzen.',
  });
  return leseKiPruefung({ hinweise }, gericht, nachId);
}

const EINHEIT: Record<string, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  el: 'el',
  tl: 'tl',
  stück: 'stueck',
  prise: 'prise',
  packung: 'packung',
  pck: 'packung',
  bund: 'bund',
};

/**
 * Reads a recipe line by line („500 g Spaghetti“, „2 Zwiebeln“, „für 4 Personen“) and maps the
 * names onto the lists like a model: the same name, else a name that contains it.
 */
export function kiRezept(
  z: MockZugang,
  gerichtId: number,
  text: string,
  wartung: boolean
): KiRezept {
  pruefeZugang(z, wartung);
  const { gericht, zutaten } = gerichtVon(z, gerichtId);
  if (FEHLER.test(text)) throw new MockKiBesetzt();
  const kandidaten = rezeptKandidaten(essenKatalog(), zutaten);
  let rezeptPersonen: number | null = null;
  const zeilen: unknown[] = [];
  for (const roh of text.split('\n')) {
    const zeile = roh.trim().replace(/^[-*•]\s*/, '');
    if (!zeile) continue;
    const personen = /f(?:ü|ue)r (\d+) (?:Personen|Portionen)/i.exec(zeile);
    if (personen) {
      rezeptPersonen = Number(personen[1]);
      continue;
    }
    const teile =
      /^(\d+(?:[.,]\d+)?)?\s*(g|kg|ml|l|EL|TL|Stück|Prise|Packung|Pck\.?|Bund)?\.?\s+(.+)$/i.exec(
        zeile
      );
    const name = (teile?.[3] ?? zeile).trim();
    const klein = name.toLocaleLowerCase('de');
    const kandidat =
      kandidaten.find((k) => k.name.toLocaleLowerCase('de') === klein) ??
      kandidaten.find((k) => k.name.toLocaleLowerCase('de').includes(klein));
    const einheit = teile?.[2] ? EINHEIT[teile[2].toLocaleLowerCase('de').replace('.', '')] : null;
    zeilen.push({
      original: zeile,
      name,
      key: kandidat?.key ?? null,
      menge: teile?.[1] ? Number(teile[1].replace(',', '.')) : null,
      einheit: teile?.[1] ? (einheit ?? 'stueck') : null,
      hinweis: '',
    });
  }
  return leseKiRezept({ rezeptPersonen, zeilen }, kandidaten, gericht.personen);
}

const GRAMM: Record<KiMass, number> = { tl: 4, el: 12, stueck: 60 };

/** A fixed estimate per measure, marked as a value of the demo. */
export function kiUmrechnung(
  z: MockZugang,
  wahl: KiZutatWahl,
  mass: KiMass,
  wartung: boolean
): KiUmrechnung {
  pruefeZugang(z, wartung);
  const zentralId =
    'zutatId' in wahl
      ? wahl.zutatId
      : z.planung.zutaten.find((zutat) => zutat.id === wahl.planungZutatId)?.zutatId;
  const zutat = essenKatalog().zutaten.find((entry) => entry.id === zentralId);
  if (zutat && FEHLER.test(zutat.name)) throw new MockKiBesetzt();
  return leseKiUmrechnung({ gramm: GRAMM[mass], begruendung: 'Beispielwert der Demo-KI.' }, mass);
}

/** Refuses amounts worked out for other people than the dish has now, like the API. */
export function pruefePersonen(gericht: { personen: number }, personen: number | undefined): void {
  if (personen !== undefined && gericht.personen !== personen)
    throw new MockPlanungFehler(
      409,
      'PERSONEN_GEAENDERT',
      `Die Personenzahl des Gerichts wurde inzwischen auf ${gericht.personen} geändert. Die Mengen sind für die alte Zahl gerechnet; bitte umrechnen und noch einmal übernehmen.`
    );
}

/** A line changed with `personen` (a proposal of the AI): the dish must still have them. */
export function pruefePersonenDerZeile(z: MockZugang, zeileId: number, personen: unknown): void {
  const gericht = z.planung.gerichte.find((g) => g.zutaten.some((zeile) => zeile.id === zeileId));
  if (gericht && typeof personen === 'number') pruefePersonen(gericht, personen);
}

/** Adds lines at the end of a dish in one change, all or none, like the API; `personen` as there. */
export function gerichtZutatenSammeln(
  z: MockZugang,
  gerichtId: number,
  inputs: GerichtZutatInput[],
  personen?: number
): void {
  const gericht = z.planung.gerichte.find((entry) => entry.id === gerichtId);
  if (!gericht) throw new MockPlanungFehler(404, 'NOT_FOUND', 'Das gibt es inzwischen nicht mehr.');
  pruefePersonen(gericht, personen);
  if (gericht.zutaten.length + inputs.length > MAX_ZEILEN_PRO_GERICHT)
    throw new MockPlanungFehler(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      zeilen: `Ein Gericht hat höchstens ${MAX_ZEILEN_PRO_GERICHT} Zutaten.`,
    });
  // All or none: a bad line takes the ones before it back
  const vorher = {
    zutaten: structuredClone(gericht.zutaten),
    seq: z.planung.seq,
    aenderungen: z.planung.aenderungen.length,
  };
  for (const [index, input] of inputs.entries()) {
    try {
      gerichtZutatAnlegen(z, gerichtId, input);
    } catch (error: unknown) {
      gericht.zutaten = vorher.zutaten;
      z.planung.aenderungen.splice(0, z.planung.aenderungen.length - vorher.aenderungen);
      z.planung.seq = vorher.seq;
      if (!(error instanceof MockPlanungFehler) || !error.fields) throw error;
      throw new MockPlanungFehler(
        400,
        'INVALID',
        error.message,
        Object.fromEntries(
          Object.entries(error.fields).map(([feld, text]) => [`zeilen.${index}.${feld}`, text])
        )
      );
    }
  }
  // One change in the log, as the API writes it
  z.planung.aenderungen.splice(0, inputs.length);
  z.planung.seq = vorher.seq;
  aendere(
    z,
    'gericht-zutaten-neu',
    { gericht: gericht.name, anzahl: inputs.length },
    () => undefined
  );
}
