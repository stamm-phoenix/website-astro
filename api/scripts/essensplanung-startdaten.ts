/**
 * Writes the migration with the start data of the Essensplanung from the CSV files in
 * `api/migrations/seed/essensplanung`. Only for a database that has not applied it yet: an
 * applied migration must never change, later corrections go through the Steuerung.
 *
 *   bun scripts/essensplanung-startdaten.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStartdatenSql } from '../lib/essen-startdaten';

const migrations = resolve(__dirname, '../migrations');
const target = resolve(migrations, '0050_essensplanung_startdaten.sql');
writeFileSync(target, buildStartdatenSql(resolve(migrations, 'seed/essensplanung')));
console.log(`Written: ${target}`);
