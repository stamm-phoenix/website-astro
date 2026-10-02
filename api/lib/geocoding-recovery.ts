import { parseGeocodingState, type GeocodingState } from './geocoding-coordination';
import { mutateNikolausState, readNikolausState } from './nikolaus-state';
import { readNikolausWriteGate } from './nikolaus-write-gate';

const STATE_KEY = 'geocoding:nominatim';

export interface GeocodingReservationStatus {
  owner: string | null;
  startedAt: number | null;
}

export class GeocodingRecoveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'GeocodingRecoveryError';
  }
}

/** Operational IDs only; do not expose the cached locations or address lookup hashes. */
export async function readGeocodingReservationStatus(): Promise<GeocodingReservationStatus> {
  const state = parseGeocodingState((await readNikolausState(STATE_KEY))?.data);
  return { owner: state.lease?.owner ?? null, startedAt: state.lease?.startedAt ?? null };
}

/** Only an operator who terminated all old provider-call processes may clear a reservation. */
export async function recoverStoppedGeocodingReservation(
  geocodingOwner: string,
  maintenanceOwner: string,
  confirmation: { confirmedStopped: true }
): Promise<void> {
  if (
    !/^[a-zA-Z0-9:_.-]{1,180}$/.test(geocodingOwner) ||
    !/^[a-zA-Z0-9:_.-]{1,180}$/.test(maintenanceOwner) ||
    confirmation?.confirmedStopped !== true
  )
    throw new GeocodingRecoveryError('GEOCODING_CONFIRMATION_REQUIRED');
  const gate = await readNikolausWriteGate();
  if (gate.maintenance?.owner !== maintenanceOwner || gate.writers.length !== 0)
    throw new GeocodingRecoveryError('GEOCODING_MAINTENANCE_REQUIRED');
  await mutateNikolausState(
    STATE_KEY,
    parseGeocodingState,
    (current): GeocodingState | undefined => {
      if (!current.lease) return undefined; // A repeated recovery must preserve a later cooldown.
      if (current.lease.owner !== geocodingOwner)
        throw new GeocodingRecoveryError('GEOCODING_OWNER_MISMATCH');
      return {
        version: 1,
        nextRequestAt: Math.max(current.nextRequestAt, Date.now() + 6_100),
        cache: current.cache,
      };
    }
  );
}
