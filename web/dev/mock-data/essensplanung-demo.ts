/**
 * Content of the demo Planung (`DEMO_TOKEN`), so every area of `dev:mock` shows something: members,
 * participants, dishes with ingredients (one without a number of people, one only a name, one not
 * planned) and a plan with one to three dishes per meal, empty meals, an arrival and a departure
 * day with fewer meals and a day with an extra meal. Built once when the mock starts; the E2E
 * specs create their own Planungen.
 */
import type { GerichtEinheit, GerichtZutat } from '../../../api/lib/essen-gerichte-model';
import type { Ernaehrung } from '../../../api/lib/essen-teilnehmende-model';
import { essenKatalog } from './essensplanung';
import { zutatFuer } from './essensplanung-gerichte';
import type { MockEinplanung, MockPlanung } from './essensplanung-planung';
import { DEMO_TOKEN, neueId, neuesEtag, neuesMockToken, zugangVon } from './essensplanung-planung';

type Zeile = [
  zutat: string,
  menge: number | null,
  einheit: GerichtEinheit | null,
  extra?: Partial<Pick<GerichtZutat, 'fest' | 'fuerAlles' | 'fuerVegetarisch' | 'fuerVegan'>> & {
    hinweis?: string;
  },
];

interface DemoGericht {
  name: string;
  personen: number | null;
  zeilen: Zeile[];
  anleitung?: string;
  werkzeuge?: string[];
}

const NUR_FLEISCH = { fuerVegetarisch: false, fuerVegan: false };
const NICHT_VEGAN = { fuerVegan: false };

const GERICHTE: DemoGericht[] = [
  {
    name: 'Standardfrühstück',
    personen: 10,
    zeilen: [
      ['Brot (geschnitten)', 800, 'g'],
      ['Butter', 150, 'g', NICHT_VEGAN],
      ['Butter (vegan)', 150, 'g', { fuerAlles: false, fuerVegetarisch: false }],
      ['Marmelade', 200, 'g'],
      ['H-Milch', 2, 'l', NICHT_VEGAN],
      ['Haferflocken', 500, 'g'],
    ],
  },
  {
    name: 'Nudeln mit Tomatensoße',
    personen: 8,
    zeilen: [
      ['Nudeln (Spaghetti)', 1, 'kg'],
      ['Tomaten (passiert)', 1000, 'g'],
      ['Zwiebeln', 200, 'g'],
      ['Gouda (gerieben)', 200, 'g', NICHT_VEGAN],
      ['Salz', null, null],
    ],
    werkzeuge: ['Großer Topf', 'Nudelsieb'],
  },
  {
    name: 'Gurkensalat',
    personen: 10,
    zeilen: [
      ['Gurke', 3, 'stueck'],
      ['Essig', 50, 'ml'],
      ['Zucker (weiß)', 20, 'g'],
    ],
  },
  {
    name: 'Chili sin Carne',
    personen: 10,
    zeilen: [
      ['Sojagranulat', 300, 'g'],
      ['Tomaten (stückig)', 1600, 'g'],
      ['Kidneybohnen', 800, 'g'],
      ['Mais', 600, 'g'],
      ['Zwiebeln', 400, 'g'],
      ['Paprika', 500, 'g'],
      ['Reis (Langkorn)', 1, 'kg'],
      ['Pfeffer', null, null],
    ],
    anleitung:
      'Zwiebeln anbraten, Soja dazu, dann Tomaten, Bohnen und Mais. **Reis** extra kochen.',
    werkzeuge: ['Großer Topf', 'Reiskocher'],
  },
  {
    // Typed into the plan first, the amounts are from a recipe without the number of people yet
    name: 'Pfannkuchen',
    personen: null,
    zeilen: [
      ['Mehl (Weizen)', 500, 'g'],
      ['Eier', 8, 'stueck', NICHT_VEGAN],
      ['H-Milch', 1, 'l', NICHT_VEGAN],
      ['Zucker (weiß)', 100, 'g', { fest: true }],
      ['Apfelmus', null, null],
    ],
  },
  {
    name: 'Obstsalat',
    personen: 12,
    zeilen: [
      ['Bananen', 6, 'stueck'],
      ['Joghurt', 1000, 'g', NICHT_VEGAN],
    ],
  },
  { name: 'Kuchen vom Blech', personen: null, zeilen: [] },
  {
    name: 'Kartoffelsuppe',
    personen: 10,
    zeilen: [
      ['Kartoffeln (festkochend)', 2, 'kg'],
      ['Karotten', 500, 'g'],
      ['Zwiebeln', 200, 'g'],
      ['Wiener', 10, 'stueck', NUR_FLEISCH],
    ],
  },
  {
    name: 'Lunchpaket',
    personen: 1,
    zeilen: [
      ['Brot (geschnitten)', 120, 'g'],
      ['Müsliriegel', 1, 'stueck'],
      ['Bananen', 1, 'stueck'],
    ],
  },
  // Not planned yet: waits in the list of dishes next to the plan
  { name: 'Stockbrot', personen: null, zeilen: [['Mehl (Weizen)', 1, 'kg']] },
];

/** Day → meal name → dishes with who is responsible; `gekocht` for one that is ticked off. */
const PLAN: Record<number, Record<string, [string, string?, 'gekocht'?][]>> = {
  1: {
    'Kaffee & Kuchen': [['Kuchen vom Blech', 'Oma Ute']],
    Abendessen: [['Nudeln mit Tomatensoße', '@Kim Küche', 'gekocht'], ['Gurkensalat']],
  },
  2: {
    Frühstück: [['Standardfrühstück', '@Jo Einkauf']],
    Mittagessen: [['Pfannkuchen', '@Kim Küche'], ['Obstsalat'], ['Gurkensalat']],
    Abendessen: [['Chili sin Carne', 'Rover']],
  },
  3: {
    Frühstück: [['Standardfrühstück', '@Jo Einkauf']],
    Lunchpaket: [['Lunchpaket']],
    'Kaffee & Kuchen': [['Obstsalat']],
    Abendessen: [['Kartoffelsuppe', '@Demo Leitung'], ['Gurkensalat']],
  },
  4: {
    Frühstück: [['Standardfrühstück']],
  },
};

const TEILNEHMENDE: [gruppe: string, ernaehrung: Ernaehrung, anzahl: number][] = [
  ['Wö', 'alles', 12],
  ['Wö', 'vegetarisch', 3],
  ['Jupfi', 'alles', 10],
  ['Pfadi', 'alles', 8],
  ['Pfadi', 'vegan', 4],
  ['Rover', 'vegetarisch', 6],
  ['Leitende', 'alles', 8],
];

function mitglied(planung: MockPlanung, name: string, email: string): void {
  planung.mitglieder.push({
    id: neueId(),
    etag: neuesEtag(),
    name,
    email,
    rolle: 'bearbeiten',
    token: neuesMockToken(),
    entzogen: false,
  });
}

/** Fills the demo Planung; called once by the mock API. */
export function fuelleDemoPlanung(): void {
  const z = zugangVon(DEMO_TOKEN);
  const { planung } = z;
  if (planung.gerichte.length) return;
  const katalog = essenKatalog();
  mitglied(planung, 'Kim Küche', 'kim@example.test');
  mitglied(planung, 'Jo Einkauf', 'jo@example.test');

  const gruppen = new Map(planung.gruppen.map((g) => [g.name, g.id]));
  for (const [gruppe, ernaehrung, anzahl] of TEILNEHMENDE) {
    planung.teilnehmende.push({
      id: neueId(),
      etag: neuesEtag(),
      gruppeId: gruppen.get(gruppe)!,
      ernaehrung,
      anzahl,
      unvertraeglichkeiten: [],
      vonMahlzeitId: null,
      bisMahlzeitId: null,
      hinweis: '',
    });
  }

  const gerichte = new Map<string, number>();
  for (const demo of GERICHTE) {
    const id = neueId();
    gerichte.set(demo.name, id);
    planung.gerichte.push({
      id,
      etag: neuesEtag(),
      name: demo.name,
      personen: demo.personen,
      anleitung: demo.anleitung ?? '',
      notiz: '',
      links: [],
      werkzeuge: demo.werkzeuge ?? [],
      zutaten: demo.zeilen.map(([name, menge, einheit, extra = {}], index) => {
        const zentral = katalog.zutaten.find((zutat) => zutat.name === name);
        if (!zentral) throw new Error(`Demo-Zutat fehlt: ${name}`);
        const { hinweis = '', ...fuer } = extra;
        return {
          id: neueId(),
          etag: neuesEtag(),
          position: index + 1,
          planungZutatId: zutatFuer(z, { zutatId: zentral.id }, { lebensmittel: true }).id,
          menge,
          einheit,
          fest: false,
          fuerAlles: true,
          fuerVegetarisch: true,
          fuerVegan: true,
          ohne: [],
          nur: [],
          hinweis,
          ...fuer,
        };
      }),
    });
  }

  // Arrival without breakfast and lunch, an extra packed lunch on day 3, departure after lunch
  const [ankunft, , ausflug, abreise] = planung.tage;
  ankunft.mahlzeiten = ankunft.mahlzeiten.slice(2);
  abreise.mahlzeiten = abreise.mahlzeiten.slice(0, 2);
  ausflug.mahlzeiten.splice(2, 0, {
    id: neueId(),
    etag: neuesEtag(),
    position: 0,
    name: 'Lunchpaket',
    einplanungen: [],
    ohneGruppen: [gruppen.get('Wö')!],
  });
  for (const tag of planung.tage) tag.mahlzeiten.forEach((m, index) => (m.position = index + 1));

  const mitglieder = new Map(planung.mitglieder.map((m) => [m.name, m.id]));
  planung.tage.forEach((tag, index) => {
    const plan = PLAN[index + 1] ?? {};
    for (const mahlzeit of tag.mahlzeiten) {
      mahlzeit.einplanungen = (plan[mahlzeit.name] ?? []).map(
        ([name, zustaendig = '', status], position): MockEinplanung => {
          const mitgliedId = zustaendig.startsWith('@')
            ? (mitglieder.get(zustaendig.slice(1)) ?? null)
            : null;
          return {
            id: neueId(),
            etag: neuesEtag(),
            gerichtId: gerichte.get(name)!,
            position: position + 1,
            faktor: 1,
            zustaendigId: mitgliedId,
            zustaendigText: mitgliedId === null ? zustaendig : '',
            status: status ?? 'offen',
            verbrauch: [],
          };
        }
      );
    }
  });

  // What the cooked pasta used: a bit more pasta than planned, no cheese
  const nudeln = planung.gerichte.find((g) => g.name === 'Nudeln mit Tomatensoße')!;
  const gekocht = planung.tage[0].mahlzeiten
    .flatMap((m) => m.einplanungen)
    .find((e) => e.status === 'gekocht')!;
  gekocht.verbrauch = nudeln.zutaten
    .filter((zeile) => zeile.menge !== null && zeile.einheit !== null)
    .map((zeile, index) => ({
      planungZutatId: zeile.planungZutatId,
      menge: index === 0 ? 5.5 : index === 3 ? 0 : (zeile.menge! / 8) * 50,
      einheit: zeile.einheit!,
    }));
}
