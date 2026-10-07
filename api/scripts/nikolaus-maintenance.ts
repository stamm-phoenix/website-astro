/** Operator recovery for a stuck geocoding reservation. Status never changes anything. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getErrorStatus } from '../lib/response-utils';
import { closeDatabase, getSqlErrorNumber } from '../lib/db';
import {
  GeocodingRecoveryError,
  readGeocodingReservationStatus,
  recoverStoppedGeocodingReservation,
} from '../lib/geocoding-recovery';

interface Arguments {
  mode: 'help' | 'status' | 'recover';
  geocodingOwner?: string;
}

class OperatorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OperatorError';
  }
}

function identifier(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_.-]{1,180}$/.test(value);
}

function argumentsFrom(argv: string[]): Arguments {
  const flags = new Set(['--help', '--status', '--recover', '--processes-stopped-confirmed']);
  const values = new Set(['--geocoding-owner']);
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (args.has(name)) throw new OperatorError('INVALID_ARGUMENTS');
    if (flags.has(name)) args.set(name, 'true');
    else if (values.has(name) && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args.set(name, argv[++index]);
    } else throw new OperatorError('INVALID_ARGUMENTS');
  }
  if (args.has('--help')) {
    if (args.size !== 1) throw new OperatorError('INVALID_ARGUMENTS');
    return { mode: 'help' };
  }
  if (args.has('--status')) {
    if (args.size !== 1) throw new OperatorError('INVALID_ARGUMENTS');
    return { mode: 'status' };
  }
  const geocodingOwner = args.get('--geocoding-owner');
  if (
    !args.has('--recover') ||
    !args.has('--processes-stopped-confirmed') ||
    !identifier(geocodingOwner)
  ) {
    throw new OperatorError('RECOVERY_CONFIRMATION_REQUIRED');
  }
  return { mode: 'recover', geocodingOwner };
}

function settings(): void {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(__dirname, '../local.settings.json'), 'utf8')
    ) as {
      Values?: Record<string, string>;
    };
    for (const [key, value] of Object.entries(parsed.Values ?? {})) process.env[key] ??= value;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new OperatorError('CONFIGURATION');
  }
}

export async function runNikolausMaintenance(argv: string[]): Promise<void> {
  const args = argumentsFrom(argv);
  if (args.mode === 'help') {
    console.log('Read-only status: bun scripts/nikolaus-maintenance.ts --status');
    console.log(
      'Recover a stuck geocoding reservation: bun scripts/nikolaus-maintenance.ts --recover --geocoding-owner ID --processes-stopped-confirmed'
    );
    console.log(
      'Geocoding reservations never expire. Recover only after every old geocoding process in production and previews has terminated, not just paused.'
    );
    return;
  }
  settings();
  if (args.mode === 'recover') {
    const current = await readGeocodingReservationStatus();
    if (current.owner && current.owner !== args.geocodingOwner) {
      throw new OperatorError('GEOCODING_OWNER_MISMATCH');
    }
    await recoverStoppedGeocodingReservation(args.geocodingOwner!, { confirmedStopped: true });
  }
  console.log(
    JSON.stringify({
      scope: 'nikolaus_maintenance',
      action: args.mode === 'recover' ? 'recovered' : 'status',
      geocoding: await readGeocodingReservationStatus(),
    })
  );
}

if (require.main === module)
  runNikolausMaintenance(process.argv.slice(2))
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          scope: 'nikolaus_maintenance',
          status: 'failed',
          errorCode:
            error instanceof OperatorError || error instanceof GeocodingRecoveryError
              ? error.code
              : (getErrorStatus(error) ?? getSqlErrorNumber(error) ?? 'UNKNOWN'),
        })
      );
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
