/**
 * Finds the same people in NaMi and in the CampFlow member list and compares their fields
 * (`docs/nami-abgleich.md`). Pure functions; nothing is stored or written.
 */
import { stufenFromGroups } from './campflow-groups';
import type { CampflowPerson } from './campflow';
import type {
  AbgleichFeld,
  AbgleichFeldName,
  AbgleichPaar,
  AbgleichPerson,
  AbgleichVerbindung,
  NamiAbgleichData,
} from './nami-abgleich-model';
import type { NamiMitglied } from './nami-schema';

/** A person of either list with the values the comparison needs, already normalized. */
interface Eintrag {
  person: AbgleichPerson;
  werte: Record<AbgleichFeldName, string>;
  /** Values compared as sets (e-mail addresses, phone numbers). */
  mengen: { email: string[]; telefon: string[] };
  /** Fields that could not be read, e.g. the address of a NaMi single view that failed. */
  nichtGeladen: AbgleichFeldName[];
}

const LABELS: Record<AbgleichFeldName, string> = {
  vorname: 'Vorname',
  nachname: 'Nachname',
  geburtsdatum: 'Geburtsdatum',
  geschlecht: 'Geschlecht',
  mitgliedsnummer: 'Mitgliedsnummer',
  status: 'Status',
  eintritt: 'Eintritt',
  austritt: 'Austritt',
  stufe: 'Stufe',
  email: 'E-Mail',
  telefon: 'Telefon',
  strasse: 'Straße',
  plz: 'PLZ',
  ort: 'Ort',
};

const FELDER = Object.keys(LABELS) as AbgleichFeldName[];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** A name for matching: lower case, umlauts spelled out, without accents, spaces and dashes; any script. */
export function nameKey(name: string): string {
  return (
    name
      .toLocaleLowerCase('de')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      // Accents go, letters of every script stay, so „Иванова“ and „Петрова“ remain different
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}]/gu, '')
  );
}

/** The first of several first names, for „Anna Maria“ against „Anna“. */
function firstNameKey(name: string): string {
  return nameKey(name.split(/[\s-]+/)[0] ?? '');
}

/**
 * A Mitgliedsnummer for comparison: a plain number without leading zeros (`0012345` = `12345`),
 * anything else as written without spaces, so `M123` never meets `123`.
 */
function nummerKey(value: string): string {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  return /^\d+$/.test(compact) ? compact.replace(/^0+(?=\d)/, '') : compact;
}

/** A phone number as digits with a leading 0 instead of +49 or 0049. */
export function telefonKey(value: string): string {
  const digits = value.replace(/[^\d+]/g, '');
  // „+49 (0)8063“ keeps its national 0 after the country code
  return digits.replace(/^(\+|00)490?/, '0').replace(/\D/g, '');
}

/** A street for comparison: „Hauptstr. 3“ and „Hauptstraße 3“ are the same. */
export function strasseKey(value: string): string {
  return value
    .toLocaleLowerCase('de')
    .replace(/str\.(?=\s|\d|$)/g, 'straße')
    .replace(/strasse/g, 'straße')
    .replace(/\s+/g, '');
}

function formatDay(day: string | null): string {
  if (!day) return '';
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}`;
}

const GESCHLECHT: Record<string, string> = {
  männlich: 'männlich',
  m: 'männlich',
  male: 'männlich',
  weiblich: 'weiblich',
  f: 'weiblich',
  w: 'weiblich',
  female: 'weiblich',
  divers: 'divers',
  d: 'divers',
  diverse: 'divers',
};

function geschlecht(value: string): string {
  return GESCHLECHT[value.toLocaleLowerCase('de')] ?? value;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

/** A NaMi member as an entry; active means status „Aktiv“. */
export function namiEintrag(mitglied: NamiMitglied): Eintrag {
  const aktiv = mitglied.status === 'Aktiv';
  const stufe = stufenFromGroups([mitglied.stufe])[0] ?? '';
  const email = uniqueSorted(
    [mitglied.email, mitglied.emailVertretungsberechtigter].map((e) => e.toLowerCase())
  );
  const telefon = uniqueSorted(mitglied.telefon.map(telefonKey));
  return {
    person: {
      id: String(mitglied.id),
      vorname: mitglied.vorname,
      nachname: mitglied.nachname,
      geburtsdatum: mitglied.geburtsdatum,
      mitgliedsnummer: mitglied.mitgliedsnummer,
      aktiv,
      gruppen: [mitglied.stufe || mitglied.mitgliedstyp].filter(Boolean),
    },
    werte: {
      vorname: mitglied.vorname,
      nachname: mitglied.nachname,
      geburtsdatum: formatDay(mitglied.geburtsdatum),
      geschlecht: geschlecht(mitglied.geschlecht),
      mitgliedsnummer: mitglied.mitgliedsnummer,
      status: aktiv ? 'Mitglied' : 'Ausgetreten',
      eintritt: formatDay(mitglied.eintritt),
      austritt: formatDay(mitglied.austritt),
      stufe,
      email: email.join(', '),
      telefon: mitglied.telefon.join(', '),
      strasse: mitglied.adresse?.strasse ?? '',
      plz: mitglied.adresse?.plz ?? '',
      ort: mitglied.adresse?.ort ?? '',
    },
    mengen: { email, telefon },
    nichtGeladen: mitglied.adresse ? [] : ['strasse', 'plz', 'ort'],
  };
}

function day(value: unknown): string | null {
  const t = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

/** A CampFlow person as an entry; active means not left by `today` (`YYYY-MM-DD`, Berlin). */
export function campflowEintrag(person: CampflowPerson, today: string): Eintrag {
  const name = record(person.name);
  const address = record(person.address);
  const austritt = day(person.leave_date);
  const eintritt = day(person.join_date);
  // Someone who joins later counts as current, so the list does not hide them
  const aktiv = austritt === null || austritt > today;
  const kuenftig = aktiv && eintritt !== null && eintritt > today;
  const groups = Array.isArray(person.group_names) ? person.group_names.map(text) : [];
  const ccEmails = Array.isArray(person.cc_emails) ? person.cc_emails.map(text) : [];
  const email = uniqueSorted([text(person.primary_email), ...ccEmails].map((e) => e.toLowerCase()));
  const phones = Array.isArray(person.phone_numbers)
    ? person.phone_numbers.map((phone) => text(record(phone).number)).filter(Boolean)
    : [];
  const vorname = text(name.first_name);
  const nachname = text(name.last_name);
  return {
    person: {
      id: person.id,
      vorname,
      nachname,
      geburtsdatum: day(person.birthdate),
      mitgliedsnummer: text(person.membership_number),
      aktiv,
      gruppen: groups.filter(Boolean),
    },
    werte: {
      vorname,
      nachname,
      geburtsdatum: formatDay(day(person.birthdate)),
      geschlecht: geschlecht(text(person.gender)),
      mitgliedsnummer: text(person.membership_number),
      status: kuenftig ? `Tritt am ${formatDay(eintritt)} ein` : aktiv ? 'Mitglied' : 'Ausgetreten',
      eintritt: formatDay(eintritt),
      // Also a leave planned for later, so a date missing in NaMi shows
      austritt: formatDay(austritt),
      stufe: stufenFromGroups(groups).join(', '),
      email: email.join(', '),
      telefon: phones.join(', '),
      strasse: text(address.street),
      plz: text(address.postcode),
      ort: text(address.city),
    },
    mengen: { email, telefon: uniqueSorted(phones.map(telefonKey)) },
    nichtGeladen: [],
  };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Whether a field has the same value in both lists, ignoring spelling that means the same;
 * `null` when one side could not be read, so it is neither a difference nor a match.
 */
function gleich(feld: AbgleichFeldName, nami: Eintrag, campflow: Eintrag): boolean | null {
  if (nami.nichtGeladen.includes(feld) || campflow.nichtGeladen.includes(feld)) return null;
  const a = nami.werte[feld];
  const b = campflow.werte[feld];
  switch (feld) {
    case 'vorname':
    case 'nachname':
      return nameKey(a) === nameKey(b);
    case 'mitgliedsnummer':
      return nummerKey(a) === nummerKey(b);
    case 'email':
    case 'telefon':
      return sameSet(nami.mengen[feld], campflow.mengen[feld]);
    case 'strasse':
      return strasseKey(a) === strasseKey(b);
    case 'ort':
      return (
        a.toLocaleLowerCase('de').replace(/\s+/g, '') ===
        b.toLocaleLowerCase('de').replace(/\s+/g, '')
      );
    case 'stufe':
      // Leitende have no Stufe in NaMi; only a Stufe NaMi names is checked
      return a === '' || b.split(', ').includes(a);
    default:
      return a === b;
  }
}

export function vergleiche(nami: Eintrag, campflow: Eintrag): AbgleichFeld[] {
  return FELDER.map((feld) => ({
    feld,
    label: LABELS[feld],
    nami: nami.werte[feld],
    campflow: campflow.werte[feld],
    gleich: gleich(feld, nami, campflow),
  }));
}

type Schluessel = (eintrag: Eintrag) => string | null;

const SCHRITTE: [AbgleichVerbindung, Schluessel][] = [
  ['mitgliedsnummer', (e) => nummerKey(e.person.mitgliedsnummer) || null],
  [
    'name-geburtsdatum',
    (e) =>
      e.person.geburtsdatum && nameKey(e.person.nachname) && firstNameKey(e.person.vorname)
        ? `${nameKey(e.person.nachname)}|${firstNameKey(e.person.vorname)}|${e.person.geburtsdatum}`
        : null,
  ],
  [
    'geburtsdatum',
    (e) =>
      e.person.geburtsdatum ? `${nameKey(e.person.nachname)}|${e.person.geburtsdatum}` : null,
  ],
  [
    'geburtsdatum',
    (e) =>
      e.person.geburtsdatum ? `${firstNameKey(e.person.vorname)}|${e.person.geburtsdatum}` : null,
  ],
  ['name', (e) => `${nameKey(e.person.nachname)}|${firstNameKey(e.person.vorname)}`],
];

/** Entries by key, only keys that exactly one entry has. */
function eindeutig(eintraege: Eintrag[], schluessel: Schluessel): Map<string, Eintrag> {
  const counts = new Map<string, Eintrag[]>();
  for (const eintrag of eintraege) {
    const key = schluessel(eintrag);
    if (!key || key.startsWith('|') || key.endsWith('|')) continue;
    counts.set(key, [...(counts.get(key) ?? []), eintrag]);
  }
  return new Map([...counts].filter(([, list]) => list.length === 1).map(([k, [e]]) => [k, e]));
}

function sortiere<T extends { nachname: string; vorname: string }>(list: T[]): T[] {
  return list.sort(
    (a, b) => a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de')
  );
}

/**
 * Links each NaMi member to at most one CampFlow person. The steps run from the surest key to the
 * weakest, each only among those still unlinked, and link only where the key is unique on both
 * sides, so two siblings with the same birthday never get swapped.
 */
export function gleicheAb(
  mitglieder: NamiMitglied[],
  personen: CampflowPerson[],
  today: string,
  loadedAt: { nami: Date; campflow: Date }
): NamiAbgleichData {
  let nami = mitglieder.map(namiEintrag);
  let campflow = personen.map((person) => campflowEintrag(person, today));
  const paare: AbgleichPaar[] = [];

  for (const [verbindung, schluessel] of SCHRITTE) {
    const kandidaten = eindeutig(campflow, schluessel);
    const verbunden = new Set<Eintrag>();
    for (const [key, eintrag] of eindeutig(nami, schluessel)) {
      const partner = kandidaten.get(key);
      if (!partner) continue;
      paare.push({
        nami: eintrag.person,
        campflow: partner.person,
        verbindung,
        felder: vergleiche(eintrag, partner),
      });
      verbunden.add(eintrag).add(partner);
    }
    nami = nami.filter((e) => !verbunden.has(e));
    campflow = campflow.filter((e) => !verbunden.has(e));
  }

  return {
    namiLoadedAt: loadedAt.nami.toISOString(),
    campflowLoadedAt: loadedAt.campflow.toISOString(),
    paare: paare.sort(
      (a, b) =>
        a.nami.nachname.localeCompare(b.nami.nachname, 'de') ||
        a.nami.vorname.localeCompare(b.nami.vorname, 'de')
    ),
    nurNami: sortiere(nami.map((e) => e.person)),
    nurCampflow: sortiere(campflow.map((e) => e.person)),
  };
}
