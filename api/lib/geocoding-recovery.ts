import { parseGeocodingState, type GeocodingState } from './geocoding-coordination';
import { mutateNikolausState, readNikolausState } from './nikolaus-state';

const STATE_KEY = 'geocoding:nominatim';
/** A search that runs this long has hung; only then may its reservation be released. */
export const GEOCODING_STUCK_AFTER_MS = 10 * 60_000;

export interface GeocodingReservationStatus {
  owner: string | null;
  startedAt: number | null;
  /**
   * Time until the search counts as hung, by the server's clock, so a wrong device clock cannot
   * release a running search; `null` when the start time is unknown.
   */
  stuckInMs: number | null;
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
  const startedAt = state.lease?.startedAt ?? null;
  return {
    owner: state.lease?.owner ?? null,
    startedAt,
    stuckInMs:
      startedAt === null ? null : Math.max(0, startedAt + GEOCODING_STUCK_AFTER_MS - Date.now()),
  };
}

/** Only an operator who terminated all old provider-call processes may clear a reservation. */
export async function recoverStoppedGeocodingReservation(
  geocodingOwner: string,
  confirmation: { confirmedStopped: true }
): Promise<void> {
  if (!/^[a-zA-Z0-9:_.-]{1,180}$/.test(geocodingOwner) || confirmation?.confirmedStopped !== true)
    throw new GeocodingRecoveryError('GEOCODING_CONFIRMATION_REQUIRED');
  await mutateNikolausState(
    STATE_KEY,
    parseGeocodingState,
    (current): GeocodingState | undefined => {
      if (!current.lease) return undefined; // A repeated recovery must preserve a later cooldown.
      if (current.lease.owner !== geocodingOwner)
        throw new GeocodingRecoveryError('GEOCODING_OWNER_MISMATCH');
      // A search may still send its request; without a start time the confirmation decides
      const startedAt = current.lease.startedAt;
      if (startedAt !== undefined && Date.now() - startedAt < GEOCODING_STUCK_AFTER_MS)
        throw new GeocodingRecoveryError('GEOCODING_STILL_RUNNING');
      return {
        version: 1,
        nextRequestAt: Math.max(current.nextRequestAt, Date.now() + 6_100),
        cache: current.cache,
      };
    }
  );
}
