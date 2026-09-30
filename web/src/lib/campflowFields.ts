import type { CampflowColumn, CampflowEvent, CampflowPerson } from './types';

/** A link inside a field value (mail, phone, upload). */
export interface FieldLink {
  text: string;
  href: string;
}

/** One field of a person, ready for display. */
export interface PersonField {
  key: string;
  label: string;
  text: string;
  links?: FieldLink[];
}

/** A column of the participant table. */
export interface PersonColumn {
  key: string;
  label: string;
  /** Text shown in the table cell. */
  text: (person: CampflowPerson) => string;
  /** Value used for sorting. */
  sortValue: (person: CampflowPerson) => string | number;
}

export type PersonStatus = 'registered' | 'confirmed' | 'cancelled';

export const PERSON_STATUS_LABEL: Record<PersonStatus, string> = {
  confirmed: 'Bestätigt',
  registered: 'Angemeldet',
  cancelled: 'Storniert',
};

export const PERSON_STATUS_CLASS: Record<PersonStatus, string> = {
  confirmed: 'bg-[#e3f1e8] text-[var(--color-dpsg-pfadfinder)] border-[#b5d9c2]',
  registered: 'bg-[var(--color-brand-50)] text-brand-800 border-[var(--color-brand-200)]',
  cancelled: 'bg-[#f7e3e5] text-[var(--color-dpsg-red)] border-[#e5b8bd]',
};

/** Known standard fields in display order, with German labels. */
export const STANDARD_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  title: 'Titel',
  gender: 'Geschlecht',
  birthdate: 'Geburtsdatum',
  age: 'Alter',
  primary_email: 'E-Mail',
  email: 'E-Mail',
  cc_emails: 'Weitere E-Mails',
  phone_numbers: 'Telefon',
  address: 'Adresse',
  diet: 'Ernährung',
  intolerances: 'Unverträglichkeiten',
  health: 'Gesundheit',
  swimming: 'Schwimmer*in',
  notes: 'Notizen',
  group_names: 'Gruppen',
  label_names: 'Labels',
  price: 'Tarif',
  subsidized: 'Bezuschusst',
  payment_method: 'Zahlungsart',
  membership_number: 'Mitgliedsnummer',
  division: 'Gliederung',
  creation_date: 'Angemeldet am',
  confirmation_date: 'Bestätigt am',
  cancellation_date: 'Storniert am',
  external_id: 'Externe ID',
  id: 'CampFlow-ID',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  gender: { m: 'männlich', f: 'weiblich', d: 'divers' },
  diet: {
    vegetarian: 'vegetarisch',
    vegan: 'vegan',
    kosher: 'koscher',
    halal: 'halal',
    pescetarian: 'pescetarisch',
    meat: 'mit Fleisch',
  },
  payment_method: {
    bank_transfer: 'Überweisung',
    sepa_direct_debit: 'SEPA-Lastschrift',
    direct_debit: 'Lastschrift',
    cash: 'Bar',
    paypal: 'PayPal',
  },
};

const ADDRESS_ORDER = ['postal_info', 'street', 'address_addition'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.values(value).every(isEmpty);
  return false;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(DATE_PATTERN.test(date) ? `${date}T00:00:00Z` : date);
  return Number.isNaN(parsed.getTime()) ? date : dateFormatter.format(parsed);
}

/** Formats the time frame of an event, e.g. `03.05.2026 – 05.05.2026`. */
export function formatEventRange(event: CampflowEvent): string {
  const start = formatDate(event.start_date);
  const end = formatDate(event.end_date);
  if (!start || !end || start === end) return start || end || 'Ohne Datum';
  return `${start} – ${end}`;
}

function formatScalar(value: unknown, key?: string): string {
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'number') return value.toLocaleString('de-DE');
  if (typeof value !== 'string') return String(value);
  const label = key ? VALUE_LABELS[key]?.[value] : undefined;
  if (label) return label;
  if (DATE_PATTERN.test(value)) return formatDate(value);
  if (DATE_TIME_PATTERN.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : dateTimeFormatter.format(parsed);
  }
  return value;
}

export function formatName(person: CampflowPerson): string {
  const name = person.name;
  if (isRecord(name)) {
    const full = [name.first_name, name.last_name].filter(Boolean).join(' ').trim();
    if (full) return full;
  }
  return typeof name === 'string' && name ? name : '(ohne Namen)';
}

function formatAddress(address: Record<string, unknown>): string {
  const lines = ADDRESS_ORDER.map((key) => address[key]).filter(
    (v): v is string => typeof v === 'string' && v.trim() !== ''
  );
  const zip = address.zip ?? address.postal_code ?? address.postcode ?? address.zip_code;
  const cityLine = [zip, address.city].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  const countryCode = address.country_code ?? address.country;
  if (lines.length > 0 && countryCode && String(countryCode).toUpperCase() !== 'DE') {
    lines.push(String(address.country_name ?? countryCode));
  }
  const known = new Set([
    ...ADDRESS_ORDER,
    'zip',
    'postal_code',
    'postcode',
    'zip_code',
    'city',
    'country',
    'country_code',
    'country_name',
  ]);
  for (const [key, value] of Object.entries(address)) {
    if (!known.has(key) && !isEmpty(value)) lines.push(formatValue(value));
  }
  return lines.join(', ');
}

/** Formats any field value as readable text. */
export function formatValue(value: unknown, key?: string): string {
  if (isEmpty(value)) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => formatValue(item, key))
      .filter(Boolean)
      .join(', ');
  }
  if (isRecord(value)) {
    if (key === 'address') return formatAddress(value);
    if ('number' in value) {
      return value.label
        ? `${String(value.number)} (${String(value.label)})`
        : String(value.number);
    }
    if ('first_name' in value || 'last_name' in value) {
      return [value.first_name, value.last_name].filter(Boolean).join(' ');
    }
    if ('name' in value && typeof value.name === 'string') return value.name;
    if ('url' in value && typeof value.url === 'string') return 'Datei';
    return Object.entries(value)
      .filter(([, v]) => !isEmpty(v))
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join(', ');
  }
  return formatScalar(value, key);
}

function fieldLinks(key: string, value: unknown): FieldLink[] | undefined {
  if ((key === 'primary_email' || key === 'email') && typeof value === 'string') {
    return [{ text: value, href: `mailto:${value}` }];
  }
  if (key === 'cc_emails' && Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => ({ text: v, href: `mailto:${v}` }));
  }
  if (key === 'phone_numbers' && Array.isArray(value)) {
    return value.filter(isRecord).map((phone) => ({
      text: formatValue(phone),
      href: `tel:${String(phone.number ?? '').replace(/[^\d+]/g, '')}`,
    }));
  }
  const uploads = (Array.isArray(value) ? value : [value]).filter(
    (v): v is { url: string } => isRecord(v) && typeof v.url === 'string'
  );
  if (uploads.length > 0) {
    return uploads.map((upload, index) => ({
      text: uploads.length > 1 ? `Datei ${index + 1} öffnen` : 'Datei öffnen',
      href: upload.url,
    }));
  }
  return undefined;
}

/** Maps a person key to its custom column, via `col_…` id or `custom_{external_id}`. */
export function findColumn(key: string, columns: CampflowColumn[]): CampflowColumn | undefined {
  if (key.startsWith('col_')) return columns.find((c) => c.id === key);
  if (key.startsWith('custom_')) {
    const externalId = key.slice('custom_'.length);
    return columns.find((c) => c.external_id === externalId);
  }
  return undefined;
}

/** Human readable label for any person key. */
export function fieldLabel(key: string, columns: CampflowColumn[]): string {
  return STANDARD_FIELD_LABELS[key] ?? findColumn(key, columns)?.name ?? key;
}

function fieldRank(key: string, columns: CampflowColumn[]): number {
  const standard = Object.keys(STANDARD_FIELD_LABELS).indexOf(key);
  if (standard >= 0) return standard;
  const column = findColumn(key, columns);
  if (column) return 1000 + columns.indexOf(column);
  return 2000;
}

/** All non-empty fields of a person: standard fields, custom fields, then unknown ones. */
export function getPersonFields(person: CampflowPerson, columns: CampflowColumn[]): PersonField[] {
  return Object.entries(person)
    .filter(([, value]) => !isEmpty(value))
    .sort(([a], [b]) => fieldRank(a, columns) - fieldRank(b, columns) || a.localeCompare(b, 'de'))
    .map(([key, value]) => ({
      key,
      label: fieldLabel(key, columns),
      text: key === 'name' ? formatName(person) : formatValue(value, key),
      links: fieldLinks(key, value),
    }));
}

export function personStatus(person: CampflowPerson): PersonStatus {
  if (!isEmpty(person.cancellation_date)) return 'cancelled';
  if (!isEmpty(person.confirmation_date)) return 'confirmed';
  return 'registered';
}

/** Age in full years at the given reference date (`YYYY-MM-DD`), if the birthdate is known. */
export function ageAt(person: CampflowPerson, reference: string | null): number | null {
  if (typeof person.birthdate !== 'string' || !DATE_PATTERN.test(person.birthdate)) {
    return typeof person.age === 'number' ? person.age : null;
  }
  const [by, bm, bd] = person.birthdate.split('-').map(Number);
  const ref = reference && DATE_PATTERN.test(reference) ? reference : null;
  const [ry, rm, rd] = ref
    ? ref.split('-').map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
  return ry - by - (rm < bm || (rm === bm && rd < bd) ? 1 : 0);
}

// `age` is covered by the computed age column; payment details are never shown
const NON_COLUMN_KEYS = new Set(['id', 'name', 'age', 'bank_account', 'sepa_mandate']);

/** All columns available for the participant table of an event. */
export function getPersonColumns(
  persons: CampflowPerson[],
  columns: CampflowColumn[],
  event: CampflowEvent
): PersonColumn[] {
  const result: PersonColumn[] = [
    {
      key: 'name',
      label: 'Name',
      text: formatName,
      sortValue: (p) => {
        const name = isRecord(p.name) ? p.name : {};
        return `${String(name.last_name ?? '')} ${String(name.first_name ?? '')}`.toLowerCase();
      },
    },
    {
      key: 'status',
      label: 'Status',
      text: (p) => PERSON_STATUS_LABEL[personStatus(p)],
      sortValue: (p) => ['confirmed', 'registered', 'cancelled'].indexOf(personStatus(p)),
    },
    {
      key: 'age',
      label: 'Alter',
      text: (p) => {
        const age = ageAt(p, event.start_date);
        return age === null ? '' : String(age);
      },
      sortValue: (p) => ageAt(p, event.start_date) ?? -1,
    },
  ];

  const keys = new Set<string>();
  for (const person of persons) for (const key of Object.keys(person)) keys.add(key);
  for (const column of columns) keys.add(column.id);

  const sorted = [...keys]
    .filter((key) => !NON_COLUMN_KEYS.has(key))
    // Standard fields nobody filled in would only clutter the column picker
    .filter(
      (key) =>
        findColumn(key, columns) !== undefined ||
        persons.some((p) => formatValue(p[key], key) !== '')
    )
    .sort((a, b) => fieldRank(a, columns) - fieldRank(b, columns) || a.localeCompare(b, 'de'));

  for (const key of sorted) {
    const value = (p: CampflowPerson): unknown => {
      if (key in p) return p[key];
      // Custom fields may be keyed by external id instead of column id
      const column = findColumn(key, columns);
      return column?.external_id ? p[`custom_${column.external_id}`] : undefined;
    };
    result.push({
      key,
      label: fieldLabel(key, columns),
      text: (p) => formatValue(value(p), key),
      sortValue: (p) => {
        const v = value(p);
        return typeof v === 'number' ? v : formatValue(v, key).toLowerCase();
      },
    });
  }

  // Custom fields keyed by `custom_…` duplicate their `col_…` column
  const keysInTable = new Set(result.map((c) => c.key));
  return result.filter((column) => {
    if (!column.key.startsWith('custom_')) return true;
    const id = findColumn(column.key, columns)?.id;
    return !id || !keysInTable.has(id);
  });
}

/** Keys of the columns shown by default: name, status, age and all custom fields. */
export function defaultColumnKeys(available: PersonColumn[], columns: CampflowColumn[]): string[] {
  return available
    .filter(
      (c) => ['name', 'status', 'age'].includes(c.key) || findColumn(c.key, columns) !== undefined
    )
    .map((c) => c.key);
}
