import { getLastApiFailure } from './api';
import { cleanPath } from '../../../api/lib/problemmeldung-model';
import type {
  ProblemEntry,
  ProblemLabel,
  StaffProblemMeldung,
} from '../../../api/lib/problemmeldung-model';

// The rules of „Problem melden“ are shared with the API, which validates reports against
// them and cleans their technical context. Edit them in api/lib/problemmeldung-model.ts.
export {
  EMPTY_PROBLEM_CONTEXT,
  PROBLEM_LABELS,
  PROBLEM_MAX_LENGTH,
  PROBLEM_MIN_DESCRIPTION_LENGTH,
  buildIssueBody,
  cleanApiRoute,
  cleanPath,
  cleanProblemContext,
  describeBrowser,
  isProblemOpen,
  validateProblemReport,
} from '../../../api/lib/problemmeldung-model';
export type {
  ProblemAiStatus,
  ProblemContext,
  ProblemEntry,
  ProblemField,
  ProblemLabel,
  ProblemStatus,
  ProblemVerdict,
  StaffProblemMeldung,
} from '../../../api/lib/problemmeldung-model';

/** Answer of `GET /api/intern/pflege/problemmeldungen`. */
export interface StaffProblemMeldungenData {
  items: StaffProblemMeldung[];
  labels: readonly { id: ProblemLabel; label: string }[];
  github: {
    repository: string;
    /** Why nothing can be sent to GitHub right now; `null` if it works. */
    unavailable: 'not-configured' | 'preview' | null;
  };
  maxLength: { title: number; body: number };
}

/** Answer of `POST /api/problemmeldung`. */
export interface ProblemSent {
  status: 'sent';
  /** The number of the report, e.g. `PM-12`. */
  id: string;
}

/**
 * The link to the form from the page the visitor is on. After a failed request it carries what
 * failed (status, code, route, correlation number), so the form can show it before sending.
 */
export function problemMeldenHref(entry: ProblemEntry = 'fehler'): string {
  const params = new URLSearchParams({ quelle: entry });
  if (typeof location !== 'undefined') {
    params.set('seite', cleanPath(location.pathname));
  }
  const failure = getLastApiFailure();
  if (failure) {
    if (failure.code) params.set('code', failure.code);
    if (failure.status) params.set('status', String(failure.status));
    params.set('route', failure.route);
    if (failure.correlationId) params.set('korrelation', failure.correlationId);
  }
  return `/problem-melden?${params}`;
}
