/**
 * The hand-over of a Problemmeldung to GitHub after a leader approved it. A report becomes at
 * most one issue: the hand-over is reserved in the database first, so repeated clicks and two
 * people at once send once; an earlier attempt that ended unclear is looked up on GitHub by
 * the marker in the issue before a new one is created.
 */
import {
  GithubIssueError,
  createGithubIssue,
  findGithubIssue,
  githubIssuesUnavailable,
} from './github-issues';
import { ValidationError } from './validation/errors';
import {
  buildIssueBody,
  cleanIssueText,
  cleanIssueTitle,
  isProblemLabel,
  PROBLEM_MAX_LENGTH,
} from './problemmeldung-model';
import {
  claimProblemGithub,
  explainProblemConflict,
  getProblemMeldung,
  releaseProblemGithub,
  saveProblemGithub,
} from './problemmeldungen';
import type { ProblemDraft } from './problemmeldungen';
import type { StaffProblemMeldung } from './problemmeldung-model';

/** The draft as a request sends it, cleaned; fields that are missing or invalid are reported. */
export function validateProblemDraft(body: Record<string, unknown> | null): ProblemDraft {
  const errors: Record<string, string> = {};
  // Cleaning can lengthen a text, but a text far beyond the limit is refused before the work
  const raw = (value: unknown): number => (typeof value === 'string' ? value.length : 0);
  if (
    raw(body?.title) > PROBLEM_MAX_LENGTH.title * 3 ||
    raw(body?.body) > PROBLEM_MAX_LENGTH.body * 2
  ) {
    throw new ValidationError({
      ...(raw(body?.title) > PROBLEM_MAX_LENGTH.title * 3
        ? { title: `Der Titel darf höchstens ${PROBLEM_MAX_LENGTH.title} Zeichen lang sein.` }
        : {}),
      ...(raw(body?.body) > PROBLEM_MAX_LENGTH.body * 2
        ? { body: `Die Beschreibung darf höchstens ${PROBLEM_MAX_LENGTH.body} Zeichen lang sein.` }
        : {}),
    });
  }
  // Cleaning can make a text longer (`token=x` becomes `token: [entfernt]`), so the length that
  // counts is the cleaned one. Too long is refused, not cut: the rest would be lost without a word.
  const title = cleanIssueTitle(body?.title, Infinity);
  const text = cleanIssueText(body?.body, Infinity);
  if (title.length > PROBLEM_MAX_LENGTH.title)
    errors.title = `Der Titel darf höchstens ${PROBLEM_MAX_LENGTH.title} Zeichen lang sein.`;
  if (text.length > PROBLEM_MAX_LENGTH.body)
    errors.body = `Die Beschreibung darf höchstens ${PROBLEM_MAX_LENGTH.body} Zeichen lang sein.`;
  if (!title && !errors.title) errors.title = 'Bitte gib einen Titel an.';
  if (!isProblemLabel(body?.label)) errors.label = 'Bitte wähle ein Label.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { title, body: text, label: body?.label as ProblemDraft['label'] };
}

export interface SendOutcome {
  meldung: StaffProblemMeldung;
  /** The issue of an earlier attempt was found on GitHub, so nothing new was created. */
  found: boolean;
}

/**
 * Sends the saved draft of an open report to GitHub.
 * @param etag Version of the report the leader saw; the draft in the preview must be this one.
 * @throws ProblemStateError if the report is not open, was changed or is being sent.
 * @throws ValidationError if the draft has no title or no text.
 * @throws GithubIssueError if GitHub is not set up, refused the issue or did not answer; the
 * report and its draft are unchanged, an `unclear` one is checked on the next attempt.
 */
export async function sendProblemToGithub(
  id: string,
  etag: string,
  actor: string
): Promise<SendOutcome> {
  const current = await getProblemMeldung(id);
  if (!current) throw await explainProblemConflict(id, etag);
  if (current.status === 'verworfen' || current.status === 'uebermittelt')
    throw await explainProblemConflict(id, etag);
  if (!current.draft.title.trim() || !current.draft.body.trim()) {
    throw new ValidationError({
      title: 'Bitte schreib erst Titel und Beschreibung des Issues.',
    });
  }
  const blocked = githubIssuesUnavailable();
  if (blocked) throw new GithubIssueError(blocked, `GitHub issues unavailable: ${blocked}`);

  const claim = await claimProblemGithub(id, etag, actor);
  if (!claim) throw await explainProblemConflict(id, etag);

  const numericId = Number(id);
  const body = buildIssueBody(current.draft.body, {
    id: numericId,
    createdAt: current.createdAt,
    entry: current.entry,
    environment: current.environment,
    context: current.context,
    contact: current.contact,
  });
  try {
    if (claim.previousAttempt) {
      const existing = await findGithubIssue(numericId, claim.previousAttempt, {
        title: current.draft.title,
        body,
      });
      if (existing) {
        await saveProblemGithub(id, existing.number, existing.url);
        return { meldung: (await getProblemMeldung(id)) ?? current, found: true };
      }
    }
    const issue = await createGithubIssue({
      title: current.draft.title,
      body,
      label: current.draft.label,
    });
    await saveProblemGithub(id, issue.number, issue.url);
  } catch (error: unknown) {
    // Only an answer that certainly created nothing gives the reservation back
    if (error instanceof GithubIssueError && error.failure === 'rejected') {
      await releaseProblemGithub(id);
    }
    throw error;
  }
  return { meldung: (await getProblemMeldung(id)) ?? current, found: false };
}
