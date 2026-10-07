/** Manual season cleanup. Preview is the default; only --apply deletes. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { closeDatabase } from '../lib/db';
import {
  applyNikolausRetention,
  loadRetentionSources,
  planNikolausRetention,
} from '../lib/nikolaus-retention';
import type { RetentionOptions } from '../lib/nikolaus-retention';

function settings(): void {
  try {
    const raw = JSON.parse(readFileSync(resolve(__dirname, '../local.settings.json'), 'utf8')) as {
      Values?: Record<string, string>;
    };
    for (const [key, value] of Object.entries(raw.Values ?? {})) process.env[key] ??= value;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Operator environments may provide all configuration directly.
  }
}

/** Plans and reports contain record IDs; keep them outside the repo and readable by the owner. */
function save(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export async function runNikolausRetention(argv: string[]): Promise<void> {
  const flags = new Set(['--apply', '--help']);
  const names = new Set(['--season', '--before', '--responsible', '--output']);
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (options.has(name)) throw new Error(`Repeated argument: ${name}`);
    if (flags.has(name)) options.set(name, 'true');
    else if (names.has(name) && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      options.set(name, argv[++index]);
    } else throw new Error(`Invalid argument: ${name}`);
  }
  if (options.has('--help')) {
    console.log(
      'Preview: bun scripts/nikolaus-retention.ts --season YEAR --before YYYY-MM-DD --responsible NAME --output PATH'
    );
    console.log('Delete: the same command with --apply; --output then receives the report.');
    return;
  }
  const output = options.get('--output');
  if (!output) throw new Error('--output PATH is required');
  const retention: RetentionOptions = {
    season: Number(options.get('--season')),
    before: options.get('--before') ?? '',
    responsibleRole: options.get('--responsible') ?? '',
  };
  settings();
  if (!options.has('--apply')) {
    const plan = planNikolausRetention(await loadRetentionSources(), retention);
    save(resolve(output), plan);
    console.log(
      `Preview saved. ${plan.bookingIds.length} bookings, ${plan.helperIds.length} helpers, ${plan.dispoRows} Dispo and ${plan.einteilungRows} Einteilung rows, ${plan.retained.length} retained records. Nothing deleted.`
    );
    return;
  }
  const report = await applyNikolausRetention(retention);
  save(resolve(output), report);
  console.log(
    `Retention report saved. Complete: ${report.complete}. Deleted ${report.deleted.bookings} bookings and ${report.deleted.helpers} helpers.`
  );
  if (!report.complete) process.exitCode = 1;
}

if (require.main === module)
  runNikolausRetention(process.argv.slice(2))
    .catch((error: unknown) => {
      // Do not print database errors or family data.
      if (error instanceof Error && !('number' in error)) console.error(error.message);
      else console.error('Retention stopped. Nothing was deleted; check the database access.');
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
