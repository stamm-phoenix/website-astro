import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { GithubIssueError, githubIssuesUnavailable } from '../lib/github-issues';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  ok,
  pflegeHandler,
  readEtag,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import { HELP_CONTACTS } from '../lib/help-contacts';
import { CONFIG } from '../lib/config';
import { PROBLEM_LABELS, PROBLEM_MAX_LENGTH } from '../lib/problemmeldung-model';
import { problemDiscardSchema } from '../lib/problemmeldung-schema';
import { runProblemAssessment } from '../lib/problemmeldung-ki';
import { sendProblemToGithub, validateProblemDraft } from '../lib/problemmeldung-senden';
import {
  ProblemStateError,
  discardProblemMeldung,
  getProblemMeldung,
  getProblemMeldungen,
  purgeExpiredProblemMeldungen,
  saveProblemDraft,
} from '../lib/problemmeldungen';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { parseWith } from '../lib/validation/zod';

/** Maps what the hand-over can fail with to a response; other errors are rethrown. */
function toResponse(error: unknown): HttpResponseInit {
  if (error instanceof ProblemStateError) return errorResponse(409, 'STATE', error.message);
  if (error instanceof GithubIssueError) {
    switch (error.failure) {
      case 'not-configured':
        return errorResponse(
          503,
          'GITHUB_NOT_CONFIGURED',
          `Die Weitergabe an GitHub ist noch nicht eingerichtet. Die Meldung ist unverändert. Schreib bitte an ${HELP_CONTACTS.technik}.`
        );
      case 'preview':
        return errorResponse(
          409,
          'GITHUB_PREVIEW',
          'In der Vorschau wird nichts an GitHub gesendet. Die Meldung ist unverändert.'
        );
      case 'rejected':
        return errorResponse(
          502,
          'GITHUB_REJECTED',
          `GitHub hat das Issue abgelehnt. Die Meldung und dein Entwurf sind unverändert. Versuch es später noch einmal oder schreib an ${HELP_CONTACTS.technik}.`
        );
      case 'unclear':
        return errorResponse(
          502,
          'GITHUB_UNCLEAR',
          'Es ist unklar, ob das Issue angelegt wurde. Warte zwei Minuten und tippe dann noch einmal auf „An GitHub senden“: Vorher wird nachgesehen, ob es schon da ist.'
        );
      case 'needs-review':
        return errorResponse(
          502,
          'GITHUB_NEEDS_REVIEW',
          `Ein GitHub-Eintrag mit dieser Meldungsnummer wurde verändert. Es wurde kein weiterer Eintrag angelegt. Schreib an ${HELP_CONTACTS.technik} und nenne die Meldungsnummer.`
        );
    }
  }
  throw error;
}

/**
 * GET: all reports with the state of the hand-over to GitHub, the labels to choose from and
 * the limits of the form; opening the module also deletes reports past their retention.
 */
export const ProblemMeldungenCollectionEndpoint = pflegeHandler(
  'problemmeldungen',
  async (request: HttpRequest) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    await purgeExpiredProblemMeldungen();
    return ok({
      items: await getProblemMeldungen(),
      labels: PROBLEM_LABELS,
      github: {
        repository: CONFIG.problemmeldung.githubRepository,
        unavailable: githubIssuesUnavailable(),
      },
      maxLength: { title: PROBLEM_MAX_LENGTH.title, body: PROBLEM_MAX_LENGTH.body },
    });
  }
);

function readId(request: HttpRequest): string | null {
  const id = request.params.id ?? '';
  return /^\d+$/.test(id) ? id : null;
}

/** PATCH: saves the issue draft (title, text, label) of an open report; 409 if it was changed. */
export const ProblemMeldungItemEndpoint = pflegeHandler(
  'problemmeldungen',
  async (request: HttpRequest, _context, principal) => {
    const id = readId(request);
    if (!id) return NOT_FOUND;
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const draft = validateProblemDraft(body);
    try {
      await saveProblemDraft(id, draft, requireVersion(readEtag(body)), principal.userDetails);
    } catch (error: unknown) {
      return toResponse(error);
    }
    const meldung = await getProblemMeldung(id);
    return meldung ? ok(meldung) : NOT_FOUND;
  }
);

/** POST: discards an open report, with a reason if given. */
export const ProblemMeldungDiscardEndpoint = pflegeHandler(
  'problemmeldungen',
  async (request: HttpRequest, _context, principal) => {
    const id = readId(request);
    if (!id) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    const { reason } = parseWith(problemDiscardSchema, body);
    try {
      await discardProblemMeldung(
        id,
        reason,
        requireVersion(readEtag(body)),
        principal.userDetails
      );
    } catch (error: unknown) {
      return toResponse(error);
    }
    const meldung = await getProblemMeldung(id);
    return meldung ? ok(meldung) : NOT_FOUND;
  }
);

/**
 * POST: sends the saved draft of an open report to GitHub and stores the issue. Only a leader's
 * request does this; the assessment of the model never does.
 */
export const ProblemMeldungGithubEndpoint = pflegeHandler(
  'problemmeldungen',
  async (request: HttpRequest, _context, principal) => {
    const id = readId(request);
    if (!id) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const body = await readJsonBody(request);
    try {
      const { meldung, found } = await sendProblemToGithub(
        id,
        requireVersion(readEtag(body)),
        principal.userDetails
      );
      return ok({ meldung, found });
    } catch (error: unknown) {
      return toResponse(error);
    }
  }
);

/** POST: asks the model again after a failed or missing assessment. */
export const ProblemMeldungAssessEndpoint = pflegeHandler(
  'problemmeldungen',
  async (request: HttpRequest) => {
    const id = readId(request);
    if (!id) return NOT_FOUND;
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const { meldung, started } = await runProblemAssessment(id);
    if (!meldung) return NOT_FOUND;
    if (!started) {
      return errorResponse(
        409,
        'STATE',
        'Die Meldung ist schon bewertet oder nicht mehr offen. Lade sie neu.'
      );
    }
    return ok(meldung);
  }
);

export const ProblemMeldungenCollection = withErrorHandling(ProblemMeldungenCollectionEndpoint);
export const ProblemMeldungItem = withErrorHandling(ProblemMeldungItemEndpoint);
export const ProblemMeldungDiscard = withErrorHandling(ProblemMeldungDiscardEndpoint);
export const ProblemMeldungGithub = withErrorHandling(ProblemMeldungGithubEndpoint);
export const ProblemMeldungAssess = withErrorHandling(ProblemMeldungAssessEndpoint);
