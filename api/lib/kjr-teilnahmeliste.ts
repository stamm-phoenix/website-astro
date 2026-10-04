import type { KjrPerson } from './abrechnung';
import { readZip, writeZip } from './zip';

// Fills the KJR Rosenheim's Excel template „Teilnahmeliste“ (Stand 05/2024), which is uploaded
// with the grant application. Only input cells are written; the template's formulas (lfd. Nr.,
// Ort, Landkreis/Stadt/andere, sums, statistics) stay and recalculate when the file is opened.

const SHEET = 'xl/worksheets/sheet1.xml';
const WORKBOOK = 'xl/workbook.xml';

/** Rows of part I (Betreuer*innen) and part II (Teilnehmende) in the template. */
const BETREUER_ROWS = { first: 13, last: 33 };
const TEILNEHMENDE_ROWS = { first: 41, last: 160 };
/** The KJR counts at most this many nights per person (see the template's control sums). */
export const KJR_MAX_NIGHTS = 13;

/** Column for the nights of a Teilnehmer*in, by where they live. */
const NIGHTS_COLUMN = { landkreis: 'I', stadt: 'K', andere: 'M' } as const;

export interface KjrListeKopf {
  antragsteller: string;
  titel: string;
  ort: string;
  /** Five digits, or empty. */
  plz: string;
  /** `YYYY-MM-DD` */
  beginn: string | null;
  /** `HH:MM`, or empty. */
  beginnZeit: string;
  ende: string | null;
  endeZeit: string;
}

export interface KjrListeInput {
  kopf: KjrListeKopf;
  persons: KjrPerson[];
  /** Overnight stays of the Aktion, without Zusatztag; 0 for a single day. */
  nights: number;
}

export class KjrListeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KjrListeError';
  }
}

type CellValue = string | number | null;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replaces the cell `ref`, keeping its style. All cells written here exist in the template. */
function setCell(xml: string, ref: string, value: CellValue): string {
  if (value === null || value === '') return xml;
  const pattern = new RegExp(
    `<c r="${ref}"((?: [a-z]+="[^"]*")*?)\\s*(?:/>|>(?:(?!</c>).)*</c>)`,
    's'
  );
  const match = pattern.exec(xml);
  if (!match) throw new Error(`Cell ${ref} missing in the KJR template`);
  const style = /\bs="(\d+)"/.exec(match[1])?.[1];
  const s = style ? ` s="${style}"` : '';
  const cell =
    typeof value === 'number'
      ? `<c r="${ref}"${s}><v>${value}</v></c>`
      : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  return xml.slice(0, match.index) + cell + xml.slice(match.index + match[0].length);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Excel's serial date, or null for a missing or invalid date. */
function excelDate(date: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - EXCEL_EPOCH) / DAY_MS);
}

/** Excel's fraction of a day for `HH:MM`, or null. */
function excelTime(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Math.round(((Number(match[1]) * 60 + Number(match[2])) / 1440) * 1e9) / 1e9;
}

function plzNumber(plz: string): number | null {
  return /^\d{5}$/.test(plz) ? Number(plz) : null;
}

/** Fills the template with the header and the persons and returns the new `.xlsx` file. */
export function buildKjrTeilnahmeliste(template: Buffer, input: KjrListeInput): Buffer {
  const betreuer = input.persons.filter((p) => p.betreuer);
  const teilnehmende = input.persons.filter((p) => !p.betreuer);
  const betreuerSlots = BETREUER_ROWS.last - BETREUER_ROWS.first + 1;
  const teilnehmendeSlots = TEILNEHMENDE_ROWS.last - TEILNEHMENDE_ROWS.first + 1;
  if (betreuer.length > betreuerSlots) {
    throw new KjrListeError(
      `Die KJR-Liste hat Platz für ${betreuerSlots} Betreuer*innen, die Aktion hat ${betreuer.length}.`
    );
  }
  if (teilnehmende.length > teilnehmendeSlots) {
    throw new KjrListeError(
      `Die KJR-Liste hat Platz für ${teilnehmendeSlots} Teilnehmende, die Aktion hat ${teilnehmende.length}.`
    );
  }

  // Without overnight stay the column counts days of presence: one
  const nights = input.nights > 0 ? Math.min(input.nights, KJR_MAX_NIGHTS) : 1;
  const entries = readZip(template);
  const sheet = entries.find((e) => e.name === SHEET);
  const workbook = entries.find((e) => e.name === WORKBOOK);
  if (!sheet || !workbook) throw new Error('KJR template is incomplete');

  const { kopf } = input;
  let xml = sheet.data.toString('utf8');
  xml = setCell(xml, 'D5', kopf.antragsteller);
  xml = setCell(xml, 'D6', kopf.titel);
  xml = setCell(xml, 'D7', kopf.ort);
  xml = setCell(xml, 'D8', plzNumber(kopf.plz));
  xml = setCell(xml, 'D9', excelDate(kopf.beginn));
  xml = setCell(xml, 'E9', excelTime(kopf.beginnZeit));
  xml = setCell(xml, 'F9', excelDate(kopf.ende));
  xml = setCell(xml, 'G9', excelTime(kopf.endeZeit));

  const writePerson = (row: number, person: KjrPerson): void => {
    xml = setCell(xml, `B${row}`, person.lastName);
    xml = setCell(xml, `C${row}`, person.firstName);
    xml = setCell(xml, `D${row}`, person.gender);
    xml = setCell(xml, `E${row}`, person.age);
    xml = setCell(xml, `F${row}`, plzNumber(person.plz));
  };

  betreuer.forEach((person, index) => {
    const row = BETREUER_ROWS.first + index;
    writePerson(row, person);
    xml = setCell(xml, `H${row}`, nights);
    xml = setCell(xml, `I${row}`, 'ja');
  });

  teilnehmende.forEach((person, index) => {
    const row = TEILNEHMENDE_ROWS.first + index;
    writePerson(row, person);
    // Without a valid Postleitzahl the template cannot tell where the person lives
    if (person.herkunft !== 'unbekannt') {
      xml = setCell(xml, `${NIGHTS_COLUMN[person.herkunft]}${row}`, nights);
    }
  });

  sheet.data = Buffer.from(xml, 'utf8');
  // Cached results of the formulas are from the empty template: let Excel recalculate on open
  workbook.data = Buffer.from(
    workbook.data
      .toString('utf8')
      .replace(
        /<calcPr((?: [A-Za-z]+="[^"]*")*)\s*\/>/,
        (_, attributes: string) =>
          `<calcPr${attributes.replace(/ fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`
      ),
    'utf8'
  );
  return writeZip(entries);
}
