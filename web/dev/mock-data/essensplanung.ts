/**
 * Steuerung of the Essensplanung in the mock API, with the real start data from
 * `api/migrations/seed/essensplanung` (the kitchen sheet of the Bezirkslager).
 */
import { readFileSync } from 'node:fs';
import { readCsv } from '../../../api/lib/essen-startdaten';
import type { EssenEinstellungen, ZutatInput } from '../../../api/lib/essen-validation';
import type {
  EssenAuditEntry,
  EssenKategorie,
  EssenUnvertraeglichkeit,
  EssenZutat,
  StaffEssenSteuerung,
} from '../../src/lib/types';
import { MOCK_NOW, newEtag } from './util';
import { planungenUebersicht } from './essensplanung-planung';

const ACTOR = 'leitung@example.test';

function seed(file: string): Record<string, string>[] {
  return readCsv(
    readFileSync(
      new URL(`../../../api/migrations/seed/essensplanung/${file}`, import.meta.url),
      'utf8'
    )
  );
}

const ALLERGENE: [string, string][] = [
  ['gluten', 'Gluten'],
  ['krebstiere', 'Krebstiere'],
  ['ei', 'Ei'],
  ['fisch', 'Fisch'],
  ['erdnuesse', 'Erdnüsse'],
  ['soja', 'Soja'],
  ['milch', 'Milch (Laktose)'],
  ['schalenfruechte', 'Schalenfrüchte (Nüsse)'],
  ['sellerie', 'Sellerie'],
  ['senf', 'Senf'],
  ['sesam', 'Sesam'],
  ['sulfite', 'Sulfite'],
  ['lupinen', 'Lupinen'],
  ['weichtiere', 'Weichtiere'],
];

interface MockState {
  einstellungen: EssenEinstellungen;
  etag: string;
  updatedAt: string;
  updatedBy: string;
  kategorien: Omit<EssenKategorie, 'zutaten'>[];
  unvertraeglichkeiten: Omit<EssenUnvertraeglichkeit, 'zutaten'>[];
  zutaten: EssenZutat[];
  log: EssenAuditEntry[];
  nextId: number;
}

function initialState(): MockState {
  const at = new Date(MOCK_NOW).toISOString();
  const kategorien = seed('kategorien.csv').map((row, index) => ({
    id: index + 1,
    etag: newEtag('essen'),
    name: row.name,
  }));
  const unvertraeglichkeiten = ALLERGENE.map(([schluessel, name], index) => ({
    id: index + 1,
    etag: newEtag('essen'),
    schluessel,
    name,
  }));
  const merkmale = new Map(seed('zutaten_merkmale.csv').map((row) => [row.name, row]));
  const bit = (value: string | undefined): boolean | null =>
    value === 'true' ? true : value === 'false' ? false : null;
  const zutaten = seed('zutaten.csv').map((row, index): EssenZutat => {
    const merkmal = merkmale.get(row.name);
    const food = row.lebensmittel === 'true';
    return {
      id: index + 1,
      etag: newEtag('essen'),
      name: row.name,
      kategorieId: kategorien.find((k) => k.name === row.kategorie)?.id ?? 1,
      einheitenart: row.einheitenart as EssenZutat['einheitenart'],
      abtropfgewicht: row.abtropfgewicht === 'true',
      lebensmittel: food,
      vegetarisch: food ? bit(merkmal?.vegetarisch) : null,
      vegan: food ? bit(merkmal?.vegan) : null,
      merkmaleGeprueft: false,
      hinweis: merkmal?.hinweis ?? '',
      grammProTl: null,
      grammProEl: null,
      grammProStueck: null,
      allergene: (merkmal?.allergene ?? '')
        .split(';')
        .filter(Boolean)
        .map((key) => unvertraeglichkeiten.find((u) => u.schluessel === key)?.id ?? 0)
        .filter(Boolean)
        .sort((a, b) => a - b),
      geaendertAm: at,
      geaendertVon: 'Startdaten',
    };
  });
  return {
    einstellungen: {
      anlegenExtern: false,
      whitelist: [],
      aufbewahrungMonate: 12,
      wartung: false,
      vorlageGruppen: [
        { name: 'Wö', faktor: 0.7 },
        { name: 'Jupfi', faktor: 0.8 },
        { name: 'Pfadi', faktor: 1 },
        { name: 'Rover', faktor: 1.2 },
        { name: 'Leitende', faktor: 1.2 },
      ],
      vorlageMahlzeiten: [
        'Frühstück',
        'Mittagessen',
        'Kaffee & Kuchen',
        'Abendessen',
        'Mitternachtssnack',
      ],
    },
    etag: newEtag('essen'),
    updatedAt: at,
    updatedBy: 'Migration',
    kategorien,
    unvertraeglichkeiten,
    zutaten,
    log: [],
    nextId: 10_000,
  };
}

let state: MockState | null = null;

function current(): MockState {
  state ??= initialState();
  return state;
}

export function essenSteuerungView(): StaffEssenSteuerung {
  const s = current();
  const sorted = <T extends { name: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  return {
    einstellungen: structuredClone(s.einstellungen),
    etag: s.etag,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
    kategorien: sorted(
      s.kategorien.map((k) => ({
        ...k,
        zutaten: s.zutaten.filter((z) => z.kategorieId === k.id).length,
      }))
    ),
    unvertraeglichkeiten: s.unvertraeglichkeiten.map((u) => ({
      ...u,
      zutaten: s.zutaten.filter((z) => z.allergene.includes(u.id)).length,
    })),
    zutaten: sorted(structuredClone(s.zutaten)),
    planungen: planungenUebersicht(s.einstellungen.aufbewahrungMonate),
    log: structuredClone(s.log),
  };
}

/** The current settings, for the mock API of the Planungen. */
export function essenEinstellungen(): EssenEinstellungen {
  return current().einstellungen;
}

export function essenAudit(action: string, details: Record<string, unknown>): void {
  audit(action, details);
}

function audit(action: string, details: Record<string, unknown>): void {
  const s = current();
  s.log.unshift({ id: s.nextId++, at: new Date().toISOString(), actor: ACTOR, action, details });
  s.log = s.log.slice(0, 100);
}

/** Saves the settings; false if the version is outdated. */
export function saveEssenEinstellungen(einstellungen: EssenEinstellungen, etag: unknown): boolean {
  const s = current();
  if (etag !== s.etag) return false;
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(einstellungen) as (keyof EssenEinstellungen)[]) {
    const from = s.einstellungen[key];
    const to = einstellungen[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = typeof to === 'boolean' || typeof to === 'number' ? { from, to } : true;
    }
  }
  s.einstellungen = einstellungen;
  s.etag = newEtag('essen');
  s.updatedAt = new Date().toISOString();
  s.updatedBy = ACTOR;
  if (Object.keys(changes).length) audit('einstellungen', { changes });
  return true;
}

export type EssenListe = 'zutaten' | 'kategorien' | 'unvertraeglichkeiten';

/** Error of a mock write: a field message, a conflict or a missing entry. */
export type EssenMockResult =
  { ok: true; id?: number } | { field: string; message: string } | 'conflict' | 'not-found';

function nameTaken(liste: EssenListe, name: string, except?: number): boolean {
  const items: { id: number; name: string }[] = current()[liste];
  return items.some(
    (item) =>
      item.id !== except && item.name.localeCompare(name, 'de', { sensitivity: 'base' }) === 0
  );
}

const SINGULAR: Record<EssenListe, string> = {
  zutaten: 'Zutat',
  kategorien: 'Kategorie',
  unvertraeglichkeiten: 'Unverträglichkeit',
};

const PREFIX: Record<EssenListe, string> = {
  zutaten: 'zutat',
  kategorien: 'kategorie',
  unvertraeglichkeiten: 'unvertraeglichkeit',
};

export function createEssenEintrag(liste: EssenListe, input: ZutatInput | string): EssenMockResult {
  const s = current();
  const name = typeof input === 'string' ? input : input.name;
  if (nameTaken(liste, name)) {
    return { field: 'name', message: `Eine ${SINGULAR[liste]} mit diesem Namen gibt es schon.` };
  }
  const id = s.nextId++;
  if (liste === 'zutaten' && typeof input !== 'string') {
    s.zutaten.push({
      ...input,
      id,
      etag: newEtag('essen'),
      geaendertAm: new Date().toISOString(),
      geaendertVon: ACTOR,
    });
  } else if (liste === 'kategorien') {
    s.kategorien.push({ id, etag: newEtag('essen'), name });
  } else {
    s.unvertraeglichkeiten.push({ id, etag: newEtag('essen'), schluessel: null, name });
  }
  audit(`${PREFIX[liste]}-angelegt`, { id, name });
  return { ok: true, id };
}

export function changeEssenEintrag(
  liste: EssenListe,
  id: number,
  input: ZutatInput | string,
  etag: unknown
): EssenMockResult {
  const s = current();
  const items: { id: number; etag: string; name: string }[] = s[liste];
  const item = items.find((entry) => entry.id === id);
  if (!item) return 'not-found';
  if (item.etag !== etag) return 'conflict';
  const name = typeof input === 'string' ? input : input.name;
  if (nameTaken(liste, name, id)) {
    return { field: 'name', message: `Eine ${SINGULAR[liste]} mit diesem Namen gibt es schon.` };
  }
  const vorher = item.name;
  if (typeof input === 'string') item.name = input;
  else Object.assign(item, input, { geaendertAm: new Date().toISOString(), geaendertVon: ACTOR });
  item.etag = newEtag('essen');
  audit(`${PREFIX[liste]}-${liste === 'zutaten' ? 'geaendert' : 'umbenannt'}`, {
    id,
    name,
    ...(vorher !== name ? { vorher } : {}),
  });
  return { ok: true };
}

export function deleteEssenEintrag(liste: EssenListe, id: number, etag: unknown): EssenMockResult {
  const s = current();
  const items: { id: number; etag: string; name: string; schluessel?: string | null }[] = s[liste];
  const item = items.find((entry) => entry.id === id);
  if (!item) return 'not-found';
  if (item.etag !== etag) return 'conflict';
  if (liste === 'kategorien') {
    const used = s.zutaten.filter((z) => z.kategorieId === id).length;
    if (used) {
      return {
        field: 'name',
        message: `${used} Zutaten gehören zu dieser Kategorie. Ordne sie zuerst einer anderen zu.`,
      };
    }
  }
  if (item.schluessel) {
    return {
      field: 'name',
      message: 'Die 14 Hauptallergene der EU bleiben in der Liste; umbenennen geht.',
    };
  }
  if (liste === 'zutaten') s.zutaten = s.zutaten.filter((z) => z.id !== id);
  else if (liste === 'kategorien') s.kategorien = s.kategorien.filter((k) => k.id !== id);
  else {
    s.unvertraeglichkeiten = s.unvertraeglichkeiten.filter((u) => u.id !== id);
    for (const zutat of s.zutaten) zutat.allergene = zutat.allergene.filter((a) => a !== id);
  }
  audit(`${PREFIX[liste]}-geloescht`, { id, name: item.name });
  return { ok: true };
}
