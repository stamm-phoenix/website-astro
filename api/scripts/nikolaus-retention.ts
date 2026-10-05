/** Manual season cleanup. Preview is the default; only --apply authorizes writes. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beginNikolausMaintenance, endNikolausMaintenance } from '../lib/nikolaus-write-gate';
import {
  applyNikolausRetention,
  parseRetentionPlan,
  planNikolausRetention,
  type RetentionBackend,
  type RetentionReport,
} from '../lib/nikolaus-retention';
import { CONFIG } from '../lib/config';
import { createNikolausRetentionBackend } from '../lib/nikolaus-retention-backend';
import { verifyNikolausMaintenanceDeployment } from '../lib/nikolaus-retention-deployment';
import { getGraphStatus } from '../lib/sharepoint-data-access';

function settings(): void {
  try {
    const raw = JSON.parse(readFileSync(resolve(__dirname, '../local.settings.json'), 'utf8')) as {
      Values?: Record<string, string>;
    };
    for (const [key, value] of Object.entries(raw.Values ?? {})) process.env[key] ??= value;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Deployed/operator environments may provide all configuration directly.
  }
}

/** Reports contain record identifiers; keep them outside the repo and readable by the owner. */
function save(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export async function runNikolausRetention(argv: string[]): Promise<void> {
  const flags = new Set(['--apply', '--maintenance-confirmed', '--help']);
  const names = new Set(['--season', '--before', '--responsible', '--plan', '--report']);
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
      'Preview: bun scripts/nikolaus-retention.ts --season YEAR --before YYYY-MM-DD --responsible ROLE --plan PATH'
    );
    console.log(
      'Apply reviewed plan: bun scripts/nikolaus-retention.ts --apply --maintenance-confirmed --plan PATH --report PATH'
    );
    return;
  }
  const planPath = options.get('--plan');
  if (!planPath) throw new Error('--plan PATH is required');
  const absolutePlan = resolve(planPath);
  settings();
  const { targetDigest: target, backend: configuredBackend } = createNikolausRetentionBackend();
  if (!options.has('--apply')) {
    if (options.has('--maintenance-confirmed') || options.has('--report')) {
      throw new Error('--maintenance-confirmed and --report apply only to --apply');
    }
    const plan = planNikolausRetention(
      await configuredBackend.load(),
      {
        season: Number(options.get('--season')),
        before: options.get('--before') ?? '',
        responsibleRole: options.get('--responsible') ?? '',
      },
      target
    );
    save(absolutePlan, plan);
    console.log(
      `Preview saved. ${plan.operations.length} operations, ${plan.retained.length} retained records. No writes to SharePoint.`
    );
    return;
  }
  if (!options.has('--maintenance-confirmed')) {
    throw new Error(
      '--maintenance-confirmed is required after stopping public bookings and internal planning writes'
    );
  }
  if (options.has('--season') || options.has('--before') || options.has('--responsible')) {
    throw new Error(
      'Apply uses the saved plan; create another preview to change season, cutoff or role'
    );
  }
  const reportPath = options.get('--report');
  if (!reportPath || resolve(reportPath) === absolutePlan)
    throw new Error('--report requires a separate output path');
  const absoluteReport = resolve(reportPath);
  const plan = parseRetentionPlan(JSON.parse(readFileSync(absolutePlan, 'utf8')) as unknown);
  // Verify report access before any remote write can happen.
  save(absoluteReport, { planDigest: plan.digest, complete: false, status: 'starting' });
  const backend = {
    ...configuredBackend,
    report: (value: RetentionReport) => save(absoluteReport, value),
  } satisfies RetentionBackend;
  let report: RetentionReport;
  const owner = randomUUID();
  try {
    const maintenance = await beginNikolausMaintenance(owner);
    if (!maintenance.ready) throw new Error('Active Nikolaus writes must finish before cleanup');
    await verifyNikolausMaintenanceDeployment(CONFIG.nikolaus.retention.azureResourceId, owner);
    report = await applyNikolausRetention(plan, target, backend);
  } catch (error: unknown) {
    const previous = JSON.parse(readFileSync(absoluteReport, 'utf8')) as Record<string, unknown>;
    save(absoluteReport, {
      ...previous,
      complete: false,
      finishedAt: new Date().toISOString(),
      status: 'stopped',
      errorCode: getGraphStatus(error) ?? 'UNKNOWN',
    });
    throw error;
  } finally {
    await endNikolausMaintenance(owner);
  }
  console.log(
    `Retention report saved. Complete: ${report.complete}. ${report.results.length} reviewed operations.`
  );
  if (!report.complete) process.exitCode = 1;
}

if (require.main === module)
  runNikolausRetention(process.argv.slice(2)).catch((error: unknown) => {
    // Do not print Graph errors, response bodies or family data.
    if (error instanceof Error && !('statusCode' in error)) console.error(error.message);
    else console.error('Retention stopped. Inspect the saved report and retry a reviewed preview.');
    process.exitCode = 1;
  });
