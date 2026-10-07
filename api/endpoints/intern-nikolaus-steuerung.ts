import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { isStaffError, requireStaff } from '../lib/staff-auth';
import {
  SettingsConflictError,
  listAuditLog,
  loadNikolausSettings,
  saveNikolausSettings,
  validateNikolausSettings,
} from '../lib/nikolaus-settings';
import type { CleanupScope } from '../lib/nikolaus-cleanup';
import {
  CLEANUP_CONFIRMATIONS,
  deleteNikolausData,
  getCleanupStatus,
} from '../lib/nikolaus-cleanup';
import {
  GeocodingRecoveryError,
  readGeocodingReservationStatus,
  recoverStoppedGeocodingReservation,
} from '../lib/geocoding-recovery';
import { writeAuditLog } from '../lib/nikolaus-settings';
import { getDb } from '../lib/db';
import { ValidationError } from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NO_STORE_HEADERS,
  ok,
  pflegeHandler,
  readEtag,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { requestSiteRebuild } from '../lib/site-rebuild';
import { errorResponse, withErrorHandling } from '../lib/response-utils';

/** The area of the Steuerung in `pflegeHandler`: reachable while the modules are off. */
const AREA = 'nikolaus-steuerung';

/** Everything the module shows. */
async function steuerungView() {
  const [stored, cleanup, geocoding, log] = await Promise.all([
    loadNikolausSettings(),
    getCleanupStatus(),
    readGeocodingReservationStatus(),
    listAuditLog(),
  ]);
  return {
    ...stored,
    cleanup,
    confirmations: CLEANUP_CONFIRMATIONS,
    geocoding,
    log,
  };
}

/** GET: settings, data to be deleted with its deadline, geocoding reservation and log. */
export const NikolausSteuerung = pflegeHandler(AREA, async (request) => {
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
  return ok(await steuerungView());
});

/** PUT: saves the settings (etag). Public changes start a website build. */
export const NikolausSteuerungSave = pflegeHandler(
  AREA,
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const etag = requireVersion(readEtag(body));
    const settings = validateNikolausSettings(body?.settings);
    let publicChanged: boolean;
    try {
      ({ publicChanged } = await saveNikolausSettings(settings, etag, principal.userDetails));
    } catch (error: unknown) {
      if (error instanceof SettingsConflictError) {
        return {
          status: 409,
          headers: NO_STORE_HEADERS,
          jsonBody: {
            error: 'SETTINGS_CONFLICT',
            code: 'SETTINGS_CONFLICT',
            message: error.message,
            // One line per conflict; `fields` is what the forms already read
            fields: { conflicts: error.conflicts.join('\n') },
          },
        };
      }
      throw error;
    }
    // Navigation, banner and the Nikolaus page are baked into the HTML
    if (publicChanged) await requestSiteRebuild('nikolaus', context);
    return ok(await steuerungView());
  }
);

function readScope(value: unknown): CleanupScope | undefined {
  return value === 'bookings' || value === 'helpers' ? value : undefined;
}

/** POST: deletes all bookings or all helpers; the typed confirmation must match. */
export const NikolausSteuerungDelete = pflegeHandler(
  AREA,
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const scope = readScope(body?.scope);
    if (!scope) throw new ValidationError({ scope: 'Bitte auswählen, was gelöscht wird.' });
    if (body?.confirmation !== CLEANUP_CONFIRMATIONS[scope]) {
      throw new ValidationError({
        confirmation: `Bitte zur Bestätigung „${CLEANUP_CONFIRMATIONS[scope]}“ eintippen.`,
      });
    }
    const result = await deleteNikolausData(scope, principal.userDetails);
    context.log(`[nikolaus] ${principal.userDetails} deleted ${scope}`, result.deleted);
    return ok({ ...result, view: await steuerungView() });
  }
);

/**
 * POST: releases a stuck geocoding reservation. Only the owner shown in the module can be
 * released, so a newer reservation is never removed by mistake.
 */
export const NikolausSteuerungGeocoding = pflegeHandler(
  AREA,
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const owner = typeof body?.owner === 'string' ? body.owner : '';
    if (body?.confirmedStopped !== true) {
      throw new ValidationError({
        confirmedStopped: 'Bitte bestätigen, dass keine Adresssuche mehr läuft.',
      });
    }
    try {
      await recoverStoppedGeocodingReservation(owner, { confirmedStopped: true });
    } catch (error: unknown) {
      if (error instanceof GeocodingRecoveryError) {
        return errorResponse(
          409,
          error.code,
          'Die Sperre hat sich inzwischen geändert. Bitte neu laden und erneut prüfen.'
        );
      }
      throw error;
    }
    await writeAuditLog(getDb(), principal.userDetails, 'geocoding-release', { owner });
    return ok(await steuerungView());
  }
);

/**
 * GET: what every page of the Leitendenbereich needs to know about the Nikolausdienst: whether
 * its modules are shown, and whether the data is due for deletion.
 */
export async function GetNikolausStatusEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  const principal = requireStaff(request);
  if (isStaffError(principal)) return principal;
  const [stored, cleanup] = await Promise.all([loadNikolausSettings(), getCleanupStatus()]);
  return {
    status: 200,
    headers: NO_STORE_HEADERS,
    jsonBody: {
      staffActive: stored.settings.staffActive,
      maintenance: stored.settings.maintenance,
      deleteBy: cleanup.deleteBy,
      deletionDue: cleanup.due,
    },
  };
}

export const NikolausStatus = withErrorHandling(GetNikolausStatusEndpoint);
export const NikolausSteuerungEndpoint = withErrorHandling(NikolausSteuerung);
export const NikolausSteuerungSaveEndpoint = withErrorHandling(NikolausSteuerungSave);
export const NikolausSteuerungDeleteEndpoint = withErrorHandling(NikolausSteuerungDelete);
export const NikolausSteuerungGeocodingEndpoint = withErrorHandling(NikolausSteuerungGeocoding);
