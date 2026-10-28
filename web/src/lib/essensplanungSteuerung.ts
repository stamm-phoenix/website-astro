import type {
  EssenAuditEntry,
  EssenEinheitenart,
  EssenEinstellungen,
  EssenZutat,
  EssenZutatInput,
} from './types';

/** Shown names of the units of an ingredient. */
export const EINHEITENART_LABELS: Record<EssenEinheitenart, string> = {
  masse: 'Gewicht (g/kg)',
  volumen: 'Volumen (ml/l)',
  stueck: 'Stück',
  packung: 'Packung',
  bund: 'Bund',
};

/** Short unit for lists: kg (ATG) for drained weight. */
export function einheitKurz(zutat: Pick<EssenZutat, 'einheitenart' | 'abtropfgewicht'>): string {
  if (zutat.einheitenart === 'masse') return zutat.abtropfgewicht ? 'kg (ATG)' : 'kg';
  if (zutat.einheitenart === 'volumen') return 'l';
  if (zutat.einheitenart === 'stueck') return 'Stück';
  if (zutat.einheitenart === 'packung') return 'Packung';
  return 'Bund';
}

/** „vegan“, „vegetarisch“, „mit Fleisch/Fisch“ or „unbekannt“. */
export function ernaehrungLabel(zutat: Pick<EssenZutat, 'vegetarisch' | 'vegan'>): string {
  if (zutat.vegan) return 'vegan';
  if (zutat.vegetarisch) return 'vegetarisch';
  if (zutat.vegetarisch === false) return 'nicht vegetarisch';
  return 'unbekannt';
}

/** Form of the settings; numbers stay text while typing. */
export interface EinstellungenForm {
  anlegenExtern: boolean;
  /** One address or domain per line. */
  whitelist: string;
  aufbewahrungMonate: string;
  wartung: boolean;
  vorlageGruppen: { key: number; name: string; faktor: string }[];
  vorlageMahlzeiten: { key: number; name: string }[];
}

let nextKey = 0;

export function toEinstellungenForm(einstellungen: EssenEinstellungen): EinstellungenForm {
  return {
    anlegenExtern: einstellungen.anlegenExtern,
    whitelist: einstellungen.whitelist.join('\n'),
    aufbewahrungMonate: String(einstellungen.aufbewahrungMonate),
    wartung: einstellungen.wartung,
    vorlageGruppen: einstellungen.vorlageGruppen.map((gruppe) => ({
      key: nextKey++,
      name: gruppe.name,
      faktor: String(gruppe.faktor).replace('.', ','),
    })),
    vorlageMahlzeiten: einstellungen.vorlageMahlzeiten.map((name) => ({ key: nextKey++, name })),
  };
}

export function newRowKey(): number {
  return nextKey++;
}

/** Reads a German decimal number; anything else becomes NaN, which the API rejects. */
export function parseDecimal(value: string): number {
  const text = value.trim().replace(',', '.');
  return text && /^\d*\.?\d+$/.test(text) ? Number(text) : Number.NaN;
}

export function fromEinstellungenForm(form: EinstellungenForm): EssenEinstellungen {
  return {
    anlegenExtern: form.anlegenExtern,
    whitelist: form.whitelist
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    aufbewahrungMonate: parseDecimal(form.aufbewahrungMonate),
    wartung: form.wartung,
    vorlageGruppen: form.vorlageGruppen.map((gruppe) => ({
      name: gruppe.name,
      faktor: parseDecimal(gruppe.faktor),
    })),
    vorlageMahlzeiten: form.vorlageMahlzeiten.map((mahlzeit) => mahlzeit.name),
  };
}

/** Compares settings regardless of the row keys of the form. */
export function canonicalEinstellungen(einstellungen: EssenEinstellungen): string {
  return JSON.stringify(einstellungen);
}

/** Form of an ingredient; numbers and the diet stay text while typing. */
export interface ZutatForm {
  id: number | null;
  etag: string;
  name: string;
  kategorieId: string;
  einheitenart: EssenEinheitenart;
  abtropfgewicht: boolean;
  lebensmittel: boolean;
  /** `vegan`, `vegetarisch`, `nein` or `unbekannt`. */
  ernaehrung: 'vegan' | 'vegetarisch' | 'nein' | 'unbekannt';
  merkmaleGeprueft: boolean;
  hinweis: string;
  grammProTl: string;
  grammProEl: string;
  grammProStueck: string;
  allergene: number[];
}

function numberText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export function toZutatForm(zutat: EssenZutat | null, kategorieId?: number): ZutatForm {
  if (!zutat) {
    return {
      id: null,
      etag: '',
      name: '',
      kategorieId: kategorieId ? String(kategorieId) : '',
      einheitenart: 'masse',
      abtropfgewicht: false,
      lebensmittel: true,
      ernaehrung: 'unbekannt',
      merkmaleGeprueft: false,
      hinweis: '',
      grammProTl: '',
      grammProEl: '',
      grammProStueck: '',
      allergene: [],
    };
  }
  return {
    id: zutat.id,
    etag: zutat.etag,
    name: zutat.name,
    kategorieId: String(zutat.kategorieId),
    einheitenart: zutat.einheitenart,
    abtropfgewicht: zutat.abtropfgewicht,
    lebensmittel: zutat.lebensmittel,
    ernaehrung: zutat.vegan
      ? 'vegan'
      : zutat.vegetarisch
        ? 'vegetarisch'
        : zutat.vegetarisch === false
          ? 'nein'
          : 'unbekannt',
    merkmaleGeprueft: zutat.merkmaleGeprueft,
    hinweis: zutat.hinweis,
    grammProTl: numberText(zutat.grammProTl),
    grammProEl: numberText(zutat.grammProEl),
    grammProStueck: numberText(zutat.grammProStueck),
    allergene: [...zutat.allergene],
  };
}

function optionalNumber(value: string): number | null {
  return value.trim() ? parseDecimal(value) : null;
}

export function fromZutatForm(form: ZutatForm): EssenZutatInput {
  return {
    name: form.name,
    kategorieId: Number(form.kategorieId),
    einheitenart: form.einheitenart,
    abtropfgewicht: form.einheitenart === 'masse' && form.abtropfgewicht,
    lebensmittel: form.lebensmittel,
    vegetarisch: form.ernaehrung === 'unbekannt' ? null : form.ernaehrung !== 'nein',
    vegan: form.ernaehrung === 'unbekannt' ? null : form.ernaehrung === 'vegan',
    merkmaleGeprueft: form.merkmaleGeprueft,
    hinweis: form.hinweis,
    grammProTl: optionalNumber(form.grammProTl),
    grammProEl: optionalNumber(form.grammProEl),
    grammProStueck: optionalNumber(form.grammProStueck),
    allergene: form.lebensmittel ? form.allergene : [],
  };
}

const EINSTELLUNG_LABELS: Record<string, string> = {
  anlegenExtern: 'Anlegen durch Externe',
  whitelist: 'Erlaubte Adressen',
  aufbewahrungMonate: 'Aufbewahrung',
  wartung: 'Wartungsmodus',
  vorlageGruppen: 'Vorlage Gruppen',
  vorlageMahlzeiten: 'Vorlage Mahlzeiten',
};

const LISTEN_AKTIONEN: Record<string, string> = {
  'zutat-angelegt': 'Zutat angelegt',
  'zutat-geaendert': 'Zutat geändert',
  'zutat-geloescht': 'Zutat gelöscht',
  'kategorie-angelegt': 'Kategorie angelegt',
  'kategorie-umbenannt': 'Kategorie umbenannt',
  'kategorie-geloescht': 'Kategorie gelöscht',
  'unvertraeglichkeit-angelegt': 'Unverträglichkeit angelegt',
  'unvertraeglichkeit-umbenannt': 'Unverträglichkeit umbenannt',
  'unvertraeglichkeit-geloescht': 'Unverträglichkeit gelöscht',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One line of the log, e.g. „Anlegen durch Externe an“ or „Zutat geändert: Honig“. */
export function describeAudit(entry: EssenAuditEntry): string {
  if (entry.action === 'einstellungen') {
    const changes = entry.details.changes;
    if (!isRecord(changes)) return 'Einstellungen geändert';
    return Object.entries(changes)
      .map(([field, change]) => {
        const label = EINSTELLUNG_LABELS[field] ?? field;
        if (isRecord(change) && typeof change.to === 'boolean')
          return `${label} ${change.to ? 'an' : 'aus'}`;
        if (isRecord(change) && typeof change.to === 'number')
          return `${label}: ${change.to} Monate`;
        return `${label} geändert`;
      })
      .join(', ');
  }
  const label = LISTEN_AKTIONEN[entry.action] ?? entry.action;
  const name = typeof entry.details.name === 'string' ? entry.details.name : '';
  const vorher =
    typeof entry.details.vorher === 'string' && entry.details.vorher !== name
      ? ` (vorher: ${entry.details.vorher})`
      : '';
  return name ? `${label}: ${name}${vorher}` : label;
}
