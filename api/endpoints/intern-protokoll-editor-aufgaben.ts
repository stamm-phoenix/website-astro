import { app } from '@azure/functions';
import { parseId } from '../lib/db';
import { NOT_FOUND, ok, readEtag } from '../lib/pflege-api';
import { validateProtokollEditorAufgabe } from '../lib/validation/protokoll-editor';
import { setOffeneAufgabeErledigt } from '../lib/protokoll-editor-aufgaben';
import { readJsonBody } from '../lib/response-utils';
import { staffHandler } from '../lib/handler';
import { AREA } from '../lib/protokoll-editor-http';

/**
 * PUT `{ erledigt, etag }`: ticks an open task off in the meeting, or opens it again, if it is
 * still the version the editor loaded (else 409). The task of the module Aufgaben changes at
 * once; the minutes keep their copy. Answers with the new version.
 */
export const EditorAufgabe = staffHandler(
  AREA,
  async (request, context, principal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    const body = await readJsonBody(request);
    const erledigt = validateProtokollEditorAufgabe(body);
    const etag = await setOffeneAufgabeErledigt(
      id,
      erledigt,
      readEtag(body),
      principal.userDetails
    );
    if (etag === undefined) return NOT_FOUND;
    context.log(
      `[pflege] ${principal.userDetails} PUT ${AREA} Aufgabe ${id} (${erledigt ? 'erledigt' : 'offen'})`
    );
    return ok({ etag });
  },
  { quiet: true }
);

app.http('internPflegeProtokollEditorAufgabe', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/protokoll-editor-aufgaben/{id}',
  handler: EditorAufgabe,
});
