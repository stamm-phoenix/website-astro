/**
 * Writes the migration that fills the conversion helper of the Essensplanung from
 * `api/migrations/seed/essensplanung/umrechnung_zuordnung.csv`. Only before it is applied: an
 * applied migration must never change, later corrections go through the Steuerung.
 *
 *   bun scripts/essensplanung-umrechnung.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUmrechnungSql } from '../lib/essen-startdaten';

const migrations = resolve(__dirname, '../migrations');
const target = resolve(migrations, '0057_essensplanung_umrechnung.sql');
writeFileSync(target, buildUmrechnungSql(resolve(migrations, 'seed/essensplanung')));
console.log(`Written: ${target}`);
