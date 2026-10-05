/** Einzelnachweise and Kostenstellen of the mock API (Leitendenbereich → Abrechnung). */
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { kjrPersons, summarizeEntries, toNachweise } from '../../../api/lib/abrechnung';
import type { NachweisInput } from '../../../api/lib/abrechnung';
import type { Abrechnung, CampflowPerson, Kostenstelle } from '../../src/lib/types';
import { CONFIG } from '../../../api/lib/config';
import {
  buildKjrTeilnahmeliste,
  KjrListeError,
  KjrListeInputError,
  parseKjrListeRequest,
} from '../../../api/lib/kjr-teilnahmeliste';
import { countNights } from '../../../api/lib/kjr-zuschuss';
import { campflowDetail } from './campflow';

export const kostenstellen: Kostenstelle[] = [
  { id: 'cun_Sola26', name: 'Sommerlager 2026 Oberjoch', archived: false },
  { id: 'cun_WoeHerbst', name: 'Wölflings-Herbstwochenende', archived: false },
  { id: 'cun_Hike', name: 'Hike 2026', archived: false },
  { id: 'cun_Stavo', name: 'Stammesversammlung', archived: false },
  { id: 'cun_Allgemein', name: 'Allgemein', archived: false },
  { id: 'cun_Sola25', name: 'Sommerlager 2025', archived: true },
];

type Eintrag = [category: string, amountEur: number];

const BUCHUNGEN: Record<string, Eintrag[]> = {
  // Deficit like the template Abrechnungsmappe: the KJR grant covers part of it
  cun_Sola26: [
    ['Teilnehmerbeiträge', 1850],
    ['Teilnehmerbeiträge', 1650],
    ['Teilnehmerbeiträge', 1400],
    ['Unterkunft', -400],
    ['Unterkunft', -2750.4],
    ['Transport', -1335.06],
    ['Transport', -620],
    ['Verpflegung', -983.37],
    ['Verpflegung', -1112.15],
    ['Verpflegung', -389.9],
    ['Material', -149.45],
    ['Programm', -310],
  ],
  // Surplus: no grant can be applied for
  cun_WoeHerbst: [
    ['Teilnehmerbeiträge', 1260],
    ['Unterkunft', -480],
    ['Verpflegung', -312.48],
    ['Material', -36.9],
  ],
  cun_Hike: [
    ['Teilnehmerbeiträge', 240],
    ['Transport', -186.4],
    ['Verpflegung', -95.2],
  ],
  // Single day without overnight stay: 5 € per person
  cun_Stavo: [
    ['Verpflegung', -64.5],
    ['Spenden', 20],
  ],
};

/** Leaders who register as participants; the KJR counts them as Betreuer*innen from 27 on. */
const BETREUENDE: Record<string, number> = { evt_Sola26: 3, evt_WoeHerbst: 1, evt_Stavo: 2 };

const BESCHREIBUNG: Record<string, string> = {
  Teilnehmerbeiträge: 'Teilnehmerbeitrag',
  Unterkunft: 'Zeltplatz',
  Transport: 'Busfahrt',
  Verpflegung: 'Einkauf Lebensmittel',
  Material: 'Bastelmaterial',
  Programm: 'Eintritt',
  Spenden: 'Spende',
};
const AUSLAGE = ['Kim Muster', 'Alex Beispiel', null];

/** Rows like the Playwright API's Einzelnachweise, with receipt numbers, dates and payers. */
function entries(costUnit: Kostenstelle): NachweisInput[] {
  return (BUCHUNGEN[costUnit.id] ?? []).map(([category, amountEur], index) => ({
    receiptNumber: amountEur > 0 ? null : `2026-${String(100 + index)}`,
    type: amountEur > 0 ? 'Beitrag' : 'Ausgabebeleg',
    description: BESCHREIBUNG[category] ?? category,
    category,
    paidBy: amountEur > 0 ? null : AUSLAGE[index % AUSLAGE.length],
    date: `2026-0${1 + (index % 9)}-${String(10 + index).padStart(2, '0')}`,
    amountEur,
  }));
}

function findKostenstelle(wanted: string): Kostenstelle | undefined {
  const name = wanted.trim().toLowerCase();
  return kostenstellen.find((k) => k.id === wanted || k.name.toLowerCase() === name);
}

/** Teilnehmende from outside the Landkreis Rosenheim, which the KJR does not subsidise. */
const AUSWAERTIGE: Record<string, { name: string; zip: string; city: string }[]> = {
  evt_Sola26: [
    { name: 'Gast München', zip: '80331', city: 'München' },
    { name: 'Gast Rosenheim', zip: '83022', city: 'Rosenheim' },
  ],
};

/** The CampFlow registrations plus leaders and guests from outside the Landkreis. */
function personsFor(id: string): CampflowPerson[] {
  const detail = campflowDetail(id);
  if (!detail) return [];
  const year = Number((detail.event.start_date ?? '2026-01-01').slice(0, 4));
  const leaders: CampflowPerson[] = Array.from({ length: BETREUENDE[id] ?? 0 }, (_, i) => ({
    id: `prs_leitung${i}`,
    name: { first_name: ['Kim', 'Alex', 'Robin'][i % 3], last_name: 'Leitung' },
    gender: i % 2 ? 'f' : 'm',
    birthdate: `${year - 28 - i * 5}-01-15`,
    address: { postcode: '83620', city: 'Feldkirchen-Westerham' },
    confirmation_date: '2026-01-01T10:00:00Z',
  }));
  const guests: CampflowPerson[] = (AUSWAERTIGE[id] ?? []).map((guest, i) => ({
    id: `prs_gast${i}`,
    name: { first_name: guest.name.split(' ')[0], last_name: guest.name.split(' ')[1] },
    gender: 'f',
    birthdate: `${year - 12 - i}-03-01`,
    address: { postcode: guest.zip, city: guest.city },
    confirmation_date: '2026-01-01T10:00:00Z',
  }));
  return [...detail.persons, ...leaders, ...guests];
}

/** Like `POST /api/intern/abrechnung/{id}/kjr-liste`: the filled template or an error. */
export function kjrListeFor(
  id: string,
  body: Record<string, unknown> | null
): { file: Uint8Array; fileName: string } | { status: number; error: string } | 'NOT_FOUND' {
  const detail = campflowDetail(id);
  if (!detail) return 'NOT_FOUND';
  const template = readFileSync(
    new URL('../../../api/assets/kjr-teilnahmeliste.xlsx', import.meta.url)
  );
  const { event } = detail;
  try {
    const input = parseKjrListeRequest(body);
    const file = buildKjrTeilnahmeliste(template, {
      kopf: {
        antragsteller: CONFIG.abrechnung.antragsteller,
        titel: event.title,
        ort: input.ort,
        plz: input.plz,
        beginn: event.start_date,
        beginnZeit: input.beginnZeit,
        ende: event.end_date ?? event.start_date,
        endeZeit: input.endeZeit,
      },
      persons: input.persons,
      nights: countNights(event.start_date, event.end_date),
    });
    return { file, fileName: `KJR-Teilnahmeliste ${event.title}.xlsx` };
  } catch (caught: unknown) {
    if (caught instanceof KjrListeInputError) return { status: 400, error: caught.message };
    if (caught instanceof KjrListeError) return { status: 422, error: caught.message };
    throw caught;
  }
}

/** Like `GET /api/intern/abrechnung/{id}`; a string is the error code. */
/** Like the Playwright API: the last export per Kostenstelle, renewed on `refresh`. */
const exports = new Map<string, string>();

function exportedAt(costUnitId: string, refresh: boolean): string {
  // The first export is an hour old, so a refresh shows a different time
  if (refresh || !exports.has(costUnitId)) {
    exports.set(costUnitId, new Date(Date.now() - (refresh ? 0 : 3_600_000)).toISOString());
  }
  return exports.get(costUnitId) ?? '';
}

export function abrechnungFor(
  id: string,
  requested: string,
  refresh = false
): Abrechnung | 'NOT_FOUND' | 'KOSTENSTELLE_NOT_FOUND' {
  const detail = campflowDetail(id);
  if (!detail) return 'NOT_FOUND';
  const costUnit = findKostenstelle(requested || detail.event.title);
  if (!costUnit) return 'KOSTENSTELLE_NOT_FOUND';

  return {
    event: {
      id: detail.event.id,
      title: detail.event.title,
      start_date: detail.event.start_date,
      end_date: detail.event.end_date,
    },
    costUnit: { id: costUnit.id, name: costUnit.name },
    persons: kjrPersons(personsFor(id), detail.event.start_date),
    bilanz: summarizeEntries(entries(costUnit)),
    nachweise: toNachweise(entries(costUnit)),
    exportedAt: exportedAt(costUnit.id, refresh),
    leihgebuehren: CONFIG.abrechnung.leihgebuehren,
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A grey till roll with text lines as PNG, like CampFlow's preview of a receipt. */
function receiptPng(seed: number): Uint8Array {
  const width = 240;
  const height = 520;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width);
    for (let x = 0; x < width; x++) {
      const line = y > 40 && y < height - 40 && y % 18 < 6;
      const ink = line && x > 24 && x < 24 + ((y * 7 + seed * 13) % 160) + 20;
      row[1 + x] = ink ? 60 : 245;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Like `GET /api/intern/abrechnung/belege/{nummer}/bild`: receipt 2026-101 has two pages. */
export function belegBildFor(
  nummer: string,
  page: number
): { png: Uint8Array; pages: number } | 'NOT_FOUND' {
  const known = kostenstellen.some((k) => entries(k).some((e) => e.receiptNumber === nummer));
  const match = /^2026-(\d+)$/.exec(nummer);
  if (!known || !match) return 'NOT_FOUND';
  const pages = nummer === '2026-101' ? 2 : 1;
  if (page > pages) return 'NOT_FOUND';
  return { png: receiptPng(Number(match[1]) + page), pages };
}
