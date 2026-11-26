import type { TestContext } from 'node:test';
import type {
  EssenKatalog,
  Gericht,
  KatalogZutat,
  PlanungZutat,
} from '../../lib/essen-gerichte-model';

/** Lists, a dish and a mocked deployment for the tests of the AI of the Essensplanung. */

export function katalogZutat(
  id: number,
  name: string,
  extra: Partial<KatalogZutat> = {}
): KatalogZutat {
  return {
    id,
    name,
    kategorieId: 1,
    einheitenart: 'masse',
    abtropfgewicht: false,
    lebensmittel: true,
    vegetarisch: true,
    vegan: true,
    allergene: [],
    grammProTl: null,
    grammProEl: null,
    grammProStueck: null,
    ...extra,
  };
}

export const KATALOG: EssenKatalog = {
  kategorien: [{ id: 1, name: 'Trockenware' }],
  unvertraeglichkeiten: [{ id: 7, name: 'Gluten', schluessel: 'gluten' }],
  zutaten: [
    katalogZutat(1, 'Spaghetti', { allergene: [7] }),
    katalogZutat(2, 'Olivenöl', { einheitenart: 'volumen' }),
    katalogZutat(3, 'Zucker', { grammProTl: 4, grammProEl: 12 }),
    katalogZutat(4, 'Zwiebel', { grammProStueck: 80 }),
    katalogZutat(5, 'Hackfleisch (Rind)', { vegetarisch: false, vegan: false }),
    katalogZutat(6, 'Salz'),
    // As in the start data: chopped tomatoes and kidney beans count by drained weight
    katalogZutat(8, 'Tomaten (stückig)', { abtropfgewicht: true }),
    katalogZutat(11, 'Tomaten (passiert)'),
    katalogZutat(12, 'Kidneybohnen', { abtropfgewicht: true }),
    katalogZutat(13, 'Tomatenmark'),
    katalogZutat(10, 'Sahne', { einheitenart: 'volumen' }),
    katalogZutat(14, 'Brot (Laib)', { einheitenart: 'stueck', grammProStueck: 750 }),
    katalogZutat(9, 'Spülmittel', { lebensmittel: false, einheitenart: 'volumen' }),
  ],
};

export const SPAGHETTI: PlanungZutat = {
  id: 11,
  etag: 'pz-11',
  zutatId: 1,
  name: 'Spaghetti',
  kategorieId: 1,
  einheitenart: 'masse',
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: true,
  allergene: [7],
  abweichend: { kategorie: false, einheitenart: false },
  angabenOffen: false,
  zeilen: 1,
  geschaeftId: null,
};

export const HACK: PlanungZutat = {
  ...SPAGHETTI,
  id: 12,
  zutatId: 5,
  name: 'Hackfleisch (Rind)',
  vegetarisch: false,
  vegan: false,
  allergene: [],
};

export const GERICHT: Gericht = {
  id: 21,
  etag: 'g-21',
  name: 'Spagetti Bolognese',
  personen: 10,
  anleitung: 'Kochen mit Kim Küche, Telefon 0170 1234567',
  notiz: 'Zuständig: Kim Küche',
  links: [],
  werkzeuge: [],
  zutaten: [
    {
      id: 31,
      etag: 'z-31',
      position: 1,
      planungZutatId: 11,
      menge: 100,
      einheit: 'kg',
      fest: false,
      fuerAlles: true,
      fuerVegetarisch: true,
      fuerVegan: true,
      ohne: [],
      nur: [],
      hinweis: '',
    },
    {
      id: 32,
      etag: 'z-32',
      position: 2,
      planungZutatId: 12,
      menge: 1,
      einheit: 'kg',
      fest: false,
      fuerAlles: true,
      fuerVegetarisch: true,
      fuerVegan: false,
      ohne: [],
      nur: [],
      hinweis: '',
    },
  ],
};

export function key(t: TestContext): void {
  const previous = process.env.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previous;
  });
}

export interface Gesendet {
  body: Record<string, unknown>;
}

/** Answers every request with `answer` as the model's JSON; records what was sent. */
export function modell(t: TestContext, answer: unknown): Gesendet[] {
  key(t);
  const gesendet: Gesendet[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    gesendet.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  });
  return gesendet;
}
