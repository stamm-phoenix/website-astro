/**
 * Builds `public/abrechnung/plz-orte.json`, the Orte of every German Postleitzahl, from the
 * street list of the OpenPLZ API (https://github.com/openpotato/openplzapi.data, data from
 * OpenStreetMap, ODbL). The Abrechnung shows the Ort of a Postleitzahl entered on the page.
 *
 * Run with `bun scripts/plz-orte.ts <path to src/de/osm/streets.updated.csv>` in `web/` after
 * cloning that repository; Postleitzahlen change rarely, so once a year is plenty.
 *
 * Each street names its Postleitzahl and Gemeinde (`Locality`). A Postleitzahl gets every
 * Gemeinde with at least a tenth of its streets, the largest first; streets on the border of a
 * postal area would otherwise add Gemeinden that hardly belong to it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MIN_SHARE = 0.1;
const OUTPUT = new URL('../public/abrechnung/plz-orte.json', import.meta.url);

const source = process.argv[2];
if (!source) {
  console.error('Usage: bun scripts/plz-orte.ts <streets.updated.csv>');
  process.exit(1);
}

/** The fields of a CSV line; quoted fields may contain commas and doubled quotes. */
function fields(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      result.push(current);
      current = '';
    } else current += char;
  }
  result.push(current);
  return result;
}

const lines = readFileSync(source, 'utf8').split(/\r?\n/);
const header = fields(lines[0]);
const plzColumn = header.indexOf('PostalCode');
const ortColumn = header.indexOf('Locality');
if (plzColumn < 0 || ortColumn < 0) throw new Error('Columns PostalCode and Locality missing');

const streets = new Map<string, Map<string, number>>();
for (const line of lines.slice(1)) {
  if (!line) continue;
  const row = fields(line);
  const plz = row[plzColumn]?.trim() ?? '';
  const ort = row[ortColumn]?.trim() ?? '';
  if (!/^\d{5}$/.test(plz) || !ort) continue;
  const orte = streets.get(plz) ?? new Map<string, number>();
  orte.set(ort, (orte.get(ort) ?? 0) + 1);
  streets.set(plz, orte);
}

const result: Record<string, string[]> = {};
for (const plz of [...streets.keys()].sort()) {
  const orte = [...(streets.get(plz) ?? [])].sort((a, b) => b[1] - a[1]);
  const total = orte.reduce((sum, [, count]) => sum + count, 0);
  result[plz] = orte.filter(([, count]) => count / total >= MIN_SHARE).map(([ort]) => ort);
}

writeFileSync(OUTPUT, `${JSON.stringify(result)}\n`);
console.log(`${Object.keys(result).length} Postleitzahlen written to ${OUTPUT.pathname}`);
