import { updateProtokollMetadata } from '../lib/protokoll-metadata';
import { findDrive, loadProtokoll } from '../lib/protokoll-source';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import {
  TERMIN_ACTIONS,
  assertMayChangeTermin,
  decideTermin,
  serializeProtokollTermin,
  terminWithoutSuggestion,
} from '../lib/protokoll-termin';
import { protokollContentVersion } from '../lib/protokoll-content-version';
import { ValidationError } from '../lib/validation/errors';
import { validateProtokollAction } from '../lib/validation/protokolle';
import { CONFLICT, NOT_FOUND, ok, readEtag, requireEtag } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import { staffHandler } from '../lib/handler';
import { protokollGate } from '../lib/protokoll-gate';
import { NOT_CONFIGURED, isValidId, readTermin } from '../lib/protokolle-http';

/**
 * POST: the next meeting of approved or sent minutes. `erkennen` reads it from
 * the approved file again and resets the decision; `bestaetigen` stores the date (from the
 * suggestion, corrected or entered by hand); `ablehnen` means there is no next date.
 */
export const ProtokollTermin = staffHandler(
  'protokolle',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const id = request.params.id ?? '';
    if (!isValidId(id)) return NOT_FOUND;
    const driveId = await findDrive();
    if (!driveId) return NOT_CONFIGURED;

    const body = await readJsonBody(request);
    const action = validateProtokollAction(body, TERMIN_ACTIONS);
    const etag = requireEtag(readEtag(body));

    const loaded = await loadProtokoll(driveId, id, 'current-version');
    if (!loaded) return NOT_FOUND;
    const { item, protokoll } = loaded;
    if (protokoll.etag !== etag) return CONFLICT;
    const sourceVersion = protokollContentVersion(item);
    if (!sourceVersion) {
      throw new ValidationError({
        form: 'Die Protokolldatei konnte nicht geprüft werden. Bitte neu laden und erneut versuchen.',
      });
    }
    // Archived files have no approval; the suggestion refers to the file as it is now
    const approvedVersion =
      protokoll.status === 'Archiv'
        ? sourceVersion
        : (item.metadata?.fields.FreigabeVersion ?? item.listItem?.fields?.FreigabeVersion ?? '');
    assertMayChangeTermin(protokoll, action, {
      currentVersion: protokollContentVersion(item, approvedVersion),
      approvedVersion,
    });

    const migrateApproval = protokoll.status !== 'Archiv' && sourceVersion !== approvedVersion;

    const termin =
      action === 'erkennen'
        ? await readTermin(driveId, id, item, sourceVersion, context)
        : decideTermin(
            {
              ...(protokoll.termin ?? {
                ...terminWithoutSuggestion('nicht ausgefuehrt', sourceVersion),
                extractedAt: '',
              }),
              sourceVersion,
            },
            action,
            {
              by: principal.userDetails,
              now: new Date(),
              sessionDate: protokoll.date,
              input: { date: body?.date, time: body?.time, place: body?.place },
            }
          );
    // The combined version covers workflow changes and external file edits.
    await updateProtokollMetadata(
      driveId,
      id,
      {
        Termin: serializeProtokollTermin(termin),
        ...(migrateApproval ? { FreigabeVersion: sourceVersion } : {}),
      },
      etag
    );
    return ok({ termin });
  },
  { gate: protokollGate }
);

app.http('internPflegeProtokollTermin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokolle/{id}/termin',
  handler: ProtokollTermin,
});
