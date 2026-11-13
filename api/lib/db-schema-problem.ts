import type { Generated } from 'kysely';
import type { ReadOnly, SqlTimeOrNull } from './db-schema-types';
import type {
  ProblemAiStatus,
  ProblemEntry,
  ProblemEnvironment,
  ProblemLabel,
  ProblemStatus,
  ProblemVerdict,
} from './problemmeldung-model';

/** A report of „Problem melden“ (`problem.meldung`, migration `0051_problemmeldung.sql`). */
export interface ProblemMeldungTable {
  id: Generated<number>;
  version: ReadOnly<Buffer>;
  created_at: Generated<Date>;
  entry: ProblemEntry;
  description: string;
  steps: Generated<string>;
  expected: Generated<string>;
  contact: Generated<string>;
  page: Generated<string>;
  module: Generated<string>;
  error_code: Generated<string>;
  http_status: number | null;
  action: Generated<string>;
  correlation_id: Generated<string>;
  app_version: Generated<string>;
  environment: ProblemEnvironment;
  browser: Generated<string>;
  viewport: Generated<string>;
  status: Generated<ProblemStatus>;
  ai_status: Generated<ProblemAiStatus>;
  ai_verdict: ProblemVerdict | null;
  ai_reason: Generated<string>;
  ai_error: Generated<string>;
  ai_started_at: SqlTimeOrNull;
  ai_at: SqlTimeOrNull;
  draft_title: Generated<string>;
  draft_body: Generated<string>;
  github_label: Generated<ProblemLabel>;
  reviewed_by: Generated<string>;
  reviewed_at: SqlTimeOrNull;
  discard_reason: Generated<string>;
  github_started_at: SqlTimeOrNull;
  /** Start of the first hand-over that ended unclear; the search for its issue begins here. */
  github_first_at: SqlTimeOrNull;
  github_number: number | null;
  github_url: Generated<string>;
  github_at: SqlTimeOrNull;
}
