import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Builds the migration with the start data of the Essensplanung from the CSV files in
 * `api/migrations/seed/essensplanung` (taken from the kitchen sheet of the Bezirkslager, see the
 * README there). `scripts/essensplanung-startdaten.ts` writes it; a test checks that the
 * migration still matches the files.
 */

/** Reads a CSV file with a header line into objects; fields may be quoted with `"`. */
export function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  if (!header) return [];
  return data.map((values) => {
    if (values.length !== header.length) {
      throw new Error(
        `CSV row with ${values.length} instead of ${header.length} fields: ${values.join(',')}`
      );
    }
    return Object.fromEntries(header.map((name, index) => [name, values[index]]));
  });
}

function text(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

function bit(value: string): string {
  if (value === 'true') return '1';
  if (value === 'false') return '0';
  if (value === '') return 'NULL';
  throw new Error(`Expected true, false or nothing instead of „${value}“`);
}

const ALLERGEN_KEYS = new Set([
  'gluten',
  'krebstiere',
  'ei',
  'fisch',
  'erdnuesse',
  'soja',
  'milch',
  'schalenfruechte',
  'sellerie',
  'senf',
  'sesam',
  'sulfite',
  'lupinen',
  'weichtiere',
]);

/** The SQL of the migration with the start data. */
export function buildStartdatenSql(seedDir: string): string {
  const read = (file: string) => readCsv(readFileSync(join(seedDir, file), 'utf8'));
  const kategorien = read('kategorien.csv');
  const zutaten = read('zutaten.csv');
  const merkmale = new Map(read('zutaten_merkmale.csv').map((row) => [row.name, row]));
  if (merkmale.size !== zutaten.length || zutaten.some((zutat) => !merkmale.has(zutat.name))) {
    throw new Error('zutaten_merkmale.csv must have exactly the names of zutaten.csv');
  }

  const zutatValues = zutaten.map((zutat) => {
    const merkmal = merkmale.get(zutat.name)!;
    const food = zutat.lebensmittel === 'true';
    return `  (${[
      text(zutat.name),
      text(zutat.kategorie),
      `'${zutat.einheitenart}'`,
      bit(zutat.abtropfgewicht),
      bit(zutat.lebensmittel),
      food ? bit(merkmal.vegetarisch) : 'NULL',
      food ? bit(merkmal.vegan) : 'NULL',
      text(merkmal.hinweis),
    ].join(', ')})`;
  });

  const allergene = zutaten.flatMap((zutat) =>
    merkmale
      .get(zutat.name)!
      .allergene.split(';')
      .filter(Boolean)
      .map((key) => {
        if (!ALLERGEN_KEYS.has(key)) throw new Error(`Unknown allergen „${key}“ at ${zutat.name}`);
        return `  (${text(zutat.name)}, '${key}')`;
      })
  );

  return `-- Startdaten der Essensplanung (#452) aus dem Küchen-Sheet des Bezirkslagers 2026.
-- Erzeugt von api/scripts/essensplanung-startdaten.ts aus api/migrations/seed/essensplanung,
-- nicht von Hand ändern. Vegetarisch, vegan und Allergene sind ungeprüfte Vorschläge
-- (merkmale_geprueft = 0); die Steuerung zeigt sie zum Prüfen an.

INSERT INTO essen.kategorie (name) VALUES
${kategorien.map((row) => `  (${text(row.name)})`).join(',\n')};

INSERT INTO essen.zutat (
  name, kategorie_id, einheitenart, abtropfgewicht, lebensmittel, vegetarisch, vegan, hinweis,
  geaendert_von
)
SELECT v.name, k.id, v.einheitenart, v.abtropfgewicht, v.lebensmittel, v.vegetarisch, v.vegan,
  v.hinweis, N'Startdaten'
FROM (VALUES
${zutatValues.join(',\n')}
) AS v (name, kategorie, einheitenart, abtropfgewicht, lebensmittel, vegetarisch, vegan, hinweis)
JOIN essen.kategorie AS k ON k.name = v.kategorie;

INSERT INTO essen.zutat_unvertraeglichkeit (zutat_id, unvertraeglichkeit_id)
SELECT z.id, u.id
FROM (VALUES
${allergene.join(',\n')}
) AS v (zutat, schluessel)
JOIN essen.zutat AS z ON z.name = v.zutat
JOIN essen.unvertraeglichkeit AS u ON u.schluessel = v.schluessel;
`;
}

function gramm(value: string): string {
  if (value === '') return 'NULL';
  if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0)
    throw new Error(`Expected grams like 15 or 1.5 instead of „${value}“`);
  return value;
}

/**
 * The SQL of the migration that fills the conversion helper (grams per TL, EL and piece) from
 * `umrechnung_zuordnung.csv`. Fields the Steuerung has filled meanwhile stay.
 */
export function buildUmrechnungSql(seedDir: string): string {
  const read = (file: string) => readCsv(readFileSync(join(seedDir, file), 'utf8'));
  const masse = new Set(
    read('zutaten.csv')
      .filter((zutat) => zutat.einheitenart === 'masse' && zutat.lebensmittel === 'true')
      .map((zutat) => zutat.name)
  );
  const values = read('umrechnung_zuordnung.csv').map((row) => {
    if (!masse.has(row.zutat)) throw new Error(`„${row.zutat}“ is no food measured by weight`);
    return `  (${[text(row.zutat), gramm(row.gramm_pro_tl), gramm(row.gramm_pro_el), gramm(row.gramm_pro_stueck)].join(', ')})`;
  });
  return `-- Umrechnungshilfe der Essensplanung (#452): Gramm pro TL, EL und Stück aus der
-- Umrechnungstabelle des Küchen-Sheets, den Zutaten zugeordnet. Erzeugt von
-- api/scripts/essensplanung-umrechnung.ts aus api/migrations/seed/essensplanung, nicht von Hand
-- ändern. Was die Steuerung schon eingetragen hat, bleibt.

UPDATE z SET
  gramm_pro_tl = COALESCE(z.gramm_pro_tl, v.tl),
  gramm_pro_el = COALESCE(z.gramm_pro_el, v.el),
  gramm_pro_stueck = COALESCE(z.gramm_pro_stueck, v.stueck)
FROM essen.zutat AS z
JOIN (VALUES
${values.join(',\n')}
) AS v (name, tl, el, stueck) ON v.name = z.name;
`;
}
