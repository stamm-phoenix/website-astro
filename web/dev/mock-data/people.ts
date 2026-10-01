/** Leitende, Vorstand and Gruppenstunden of the mock API. */
import type {
  Gruppenstunde,
  GruppenstundeLeitende,
  Leitende,
  StaffGruppenstunde,
  StaffLeitende,
  Vorstand,
} from '../../src/lib/types';
import { newEtag } from './util';

export const STUFEN = ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'];
export const WEEKDAYS = [
  'Montags',
  'Dienstags',
  'Mittwochs',
  'Donnerstags',
  'Freitags',
  'Samstags',
  'Sonntags',
];
/** Choice values of the Team column, in the order the API sorts them. */
export const TEAMS = [
  'Vorstand',
  'Wölflinge',
  'Jungpfadfinder',
  'Pfadfinder',
  'Rover',
  'Kasse',
  'Material',
  'Öffentlichkeitsarbeit',
];

type LeitendeSeed = Omit<StaffLeitende, 'etag'>;

const LEITENDE_SEED: LeitendeSeed[] = [
  {
    id: '1',
    name: 'Katharina Huber',
    teams: ['Vorstand', 'Rover'],
    phone: '0176 23456781',
    street: 'Münchener Straße 12',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
  {
    id: '2',
    name: 'Maximilian Gruber',
    teams: ['Vorstand', 'Pfadfinder'],
    phone: '0151 98765432',
    street: 'Rosenheimer Straße 4a',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
  {
    id: '3',
    name: 'Pfarrer Thomas Wimmer',
    teams: ['Vorstand'],
    phone: '08063 9725-0',
    street: 'Kirchplatz 1',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: false,
  },
  {
    id: '4',
    name: 'Lena Brandstetter',
    teams: ['Wölflinge'],
    phone: '0160 4455667',
    street: 'Ahornweg 7',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
  {
    id: '5',
    name: 'Jonas Obermaier',
    teams: ['Wölflinge', 'Material'],
    phone: '',
    street: '',
    postalCode: '',
    city: '',
    hasImage: true,
  },
  {
    id: '6',
    name: 'Sophie Kammerer',
    teams: ['Wölflinge'],
    phone: '0157 11223344',
    street: 'Lindenweg 3',
    postalCode: '83052',
    city: 'Bruckmühl',
    hasImage: false,
  },
  {
    id: '7',
    name: 'Felix Steinberger',
    teams: ['Jungpfadfinder'],
    phone: '0171 5566778',
    street: 'Wendelsteinstraße 21',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
  {
    id: '8',
    name: 'Anna-Lena Schwaiger',
    teams: ['Jungpfadfinder', 'Öffentlichkeitsarbeit'],
    phone: '0152 33445566',
    street: 'Schulstraße 9',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
  {
    id: '9',
    name: 'Quirin Maier',
    teams: ['Pfadfinder'],
    phone: '0175 9988776',
    street: 'Bergstraße 15',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
  {
    id: '10',
    name: 'Theresa Lechner',
    teams: ['Pfadfinder', 'Kasse'],
    phone: '0162 1239876',
    street: 'Hochriesstraße 2',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
  {
    id: '11',
    name: 'Benedikt Hofstetter',
    teams: ['Rover'],
    phone: '0170 7654321',
    street: 'Mangfallstraße 30',
    postalCode: '83052',
    city: 'Bruckmühl',
    hasImage: true,
  },
  {
    id: '12',
    name: 'Hugo Berendi',
    teams: ['Rover', 'Öffentlichkeitsarbeit'],
    phone: '0151 24681357',
    street: 'Am Bahnhof 5',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: false,
  },
  {
    id: '13',
    name: 'Magdalena Strasser',
    teams: ['Kasse'],
    phone: '08063 8123',
    street: 'Brunnenweg 11',
    postalCode: '83620',
    city: 'Feldkirchen-Westerham',
    hasImage: true,
  },
];

export const leitende: StaffLeitende[] = LEITENDE_SEED.map((person) => ({
  ...person,
  etag: newEtag(person.id),
}));

/** Uploaded photos (JPEG bytes) by person id; persons without entry get an SVG avatar. */
export const leitendePhotos = new Map<string, Uint8Array>();

export function publicLeitende(): Leitende[] {
  return leitende.map((p) => ({ id: p.id, name: p.name, teams: p.teams, hasImage: p.hasImage }));
}

export function publicVorstand(): Vorstand[] {
  return leitende
    .filter((p) => p.teams.includes('Vorstand'))
    .map((p) => ({
      id: p.id,
      name: p.name,
      telephone: p.phone || undefined,
      street: p.street || undefined,
      city: p.postalCode && p.city ? `${p.postalCode} ${p.city}` : undefined,
      hasImage: p.hasImage,
    }));
}

type GruppenstundeSeed = Omit<StaffGruppenstunde, 'etag' | 'leitende'>;

const GRUPPENSTUNDEN_SEED: GruppenstundeSeed[] = [
  {
    id: '1',
    stufe: 'Wölflinge',
    weekday: 'Freitags',
    time: '16:00 – 17:30 Uhr',
    ageRange: '7 – 10 Jahre',
    location: 'Pfarrheim Feldkirchen, Münchener Straße 1',
    description:
      '<div class="ExternalClass3F2A"><p>Bei uns Wölflingen dreht sich alles ums <strong>gemeinsame Entdecken</strong>: Wir basteln, spielen im Wald, lernen Knoten und erleben kleine Abenteuer rund um Feldkirchen.</p><p>Einmal im Jahr fahren wir gemeinsam auf ein Pfingstlager.</p></div>',
  },
  {
    id: '2',
    stufe: 'Jungpfadfinder',
    weekday: 'Donnerstags',
    time: '17:00 – 18:30 Uhr',
    ageRange: '10 – 13 Jahre',
    location: 'Pfarrheim Feldkirchen, Gruppenraum im Keller',
    description:
      '<p>Die Jungpfadfinder wagen sich an <em>größere Herausforderungen</em>: Hike mit Karte und Kompass, Feuer machen ohne Feuerzeug und erste eigene Projekte.</p><ul><li>Kluft und Halstuch ab der Versprechensfeier</li><li>Regelmäßige Wochenendaktionen</li></ul>',
  },
  {
    id: '3',
    stufe: 'Pfadfinder',
    weekday: 'Mittwochs',
    time: '18:30 – 20:00 Uhr',
    ageRange: '13 – 16 Jahre',
    location: 'Pfadfinderhütte Westerham',
    description:
      '<p>In der Pfadistufe planen die Gruppen ihre Unternehmungen weitgehend selbst. Ob Kanutour auf der Mangfall, Sozialaktion im Ort oder das große Sommerlager – hier wird mitentschieden und angepackt.</p>',
  },
  {
    id: '4',
    stufe: 'Rover',
    weekday: 'Dienstags',
    time: '19:30 – 21:00 Uhr',
    ageRange: '16 – 20 Jahre',
    location: 'Pfadfinderhütte Westerham',
    description:
      '<p>Die Roverrunde trifft sich jede Woche und verfolgt eigene Vorhaben: Dieses Jahr planen wir eine mehrwöchige Fahrt nach Schweden, renovieren die Hütte und unterstützen die jüngeren Stufen bei Lagern.</p><p>Neue Gesichter sind <strong>jederzeit willkommen</strong> – komm einfach vorbei oder schreib uns!</p><p>Übrigens: Wer selbst Leiterin oder Leiter werden möchte, kann bei uns die Ausbildung (Modulausbildung, Woodbadge) beginnen und wird dabei vom Stamm unterstützt.</p>',
  },
];

export const gruppenstunden: Omit<StaffGruppenstunde, 'leitende'>[] = GRUPPENSTUNDEN_SEED.map(
  (g) => ({ ...g, etag: newEtag(g.id) })
);

function leitendeOf(stufe: string): GruppenstundeLeitende[] {
  return leitende
    .filter((p) => p.teams.includes(stufe))
    .map((p) => ({ id: p.id, name: p.name, hasImage: p.hasImage }));
}

/** Strips the SharePoint wrapper like `sanitizeRichText` in the API. */
function editorHtml(html: string): string {
  return html.replace(/^<div class="ExternalClass[^"]*">([\s\S]*)<\/div>$/, '$1');
}

export function publicGruppenstunden(): Gruppenstunde[] {
  return gruppenstunden.map((g) => ({
    id: g.id,
    stufe: g.stufe,
    weekday: g.weekday,
    time: g.time,
    location: g.location,
    ageRange: g.ageRange,
    description: g.description,
    leitende: leitendeOf(g.stufe),
  }));
}

export function staffGruppenstunden(): StaffGruppenstunde[] {
  return gruppenstunden.map((g) => ({
    ...g,
    description: editorHtml(g.description),
    leitende: leitendeOf(g.stufe),
  }));
}
