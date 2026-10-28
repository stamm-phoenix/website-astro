import { CONFIG } from './config';
import { PREVIEW_DATABASE } from './deployment';
import { EnvironmentVariable, findEnvironment } from './environment';
import { containsIssueMarker } from './problemmeldung-model';

/**
 * Issues in the GitHub repository `CONFIG.problemmeldung.githubRepository`, created for the
 * Problemmeldungen after a leader approved them. The token (`GITHUB_ISSUES_TOKEN`, a
 * fine-grained token with only „Issues: read and write“ on that repository) stays in the
 * backend. PR previews never send: their reports are test data and would end up in the real
 * repository.
 */

// A request of the browser ends after 45 s (Static Web App): a search and the issue that may
// follow it, with the database in between, have to fit into that.
const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
/**
 * The whole search ends within this time, so it and the issue that may follow it (one request of
 * `TIMEOUT_MS`) stay shorter than the reservation of the hand-over (`GITHUB_ATTEMPT_MINUTES`).
 */
const SEARCH_DEADLINE_MS = 20_000;
/** Pages read when looking for an issue; more changes than this since the attempt are unclear. */
const MAX_SEARCH_PAGES = 10;

export interface GithubIssue {
  number: number;
  url: string;
}

/**
 * Why no issue was created. `unclear` means the request may have been processed anyway (no
 * answer, a server error): check before trying again.
 */
export type GithubIssueFailure =
  'not-configured' | 'preview' | 'rejected' | 'unclear' | 'needs-review';

export class GithubIssueError extends Error {
  constructor(
    readonly failure: GithubIssueFailure,
    message: string
  ) {
    super(message);
    this.name = 'GithubIssueError';
  }
}

/** Why issues cannot be created right now, or `null` if they can. */
export function githubIssuesUnavailable(): GithubIssueFailure | null {
  if (PREVIEW_DATABASE) return 'preview';
  return findEnvironment(EnvironmentVariable.GITHUB_ISSUES_TOKEN) ? null : 'not-configured';
}

function headers(): Record<string, string> {
  const token = findEnvironment(EnvironmentVariable.GITHUB_ISSUES_TOKEN);
  if (!token) throw new GithubIssueError('not-configured', 'GITHUB_ISSUES_TOKEN is not set');
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'stamm-phoenix-website-api',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function issuesUrl(): string {
  return `https://api.github.com/repos/${CONFIG.problemmeldung.githubRepository}/issues`;
}

async function request(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const blocked = githubIssuesUnavailable();
  if (blocked) throw new GithubIssueError(blocked, `GitHub issues unavailable: ${blocked}`);
  try {
    return await fetch(url, {
      ...init,
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new GithubIssueError('unclear', 'GitHub did not answer');
  }
}

function toIssue(value: unknown): GithubIssue | null {
  const issue = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return typeof issue.number === 'number' && typeof issue.html_url === 'string'
    ? { number: issue.number, url: issue.html_url }
    : null;
}

/**
 * Creates an issue.
 * @throws GithubIssueError `rejected` if GitHub refused it (nothing was created), `unclear` if
 * the outcome is unknown.
 */
export async function createGithubIssue(issue: {
  title: string;
  body: string;
  label: string;
}): Promise<GithubIssue> {
  const response = await request(issuesUrl(), {
    method: 'POST',
    body: JSON.stringify({ title: issue.title, body: issue.body, labels: [issue.label] }),
  });
  if (response.status >= 500) {
    throw new GithubIssueError('unclear', `GitHub answered with ${response.status}`);
  }
  if (!response.ok) {
    throw new GithubIssueError('rejected', `GitHub refused the issue: ${response.status}`);
  }
  const created = toIssue(await response.json().catch(() => null));
  if (!created) throw new GithubIssueError('unclear', 'GitHub sent an unreadable answer');
  return created;
}

/**
 * Finds the issue a report may have created in an earlier attempt, by the marker in its text.
 * Looks at the recently changed issues, which is current at once, unlike the search.
 * @param since Start of the earlier attempt.
 * @param sent Title and text that were sent. The issue is recognized by its footer and by one
 * of them, so a renamed or edited issue is still found, while somebody else's issue that only
 * quotes the footer is not. A matching footer with changed content needs manual review;
 * it never proves that no issue exists.
 * @throws GithubIssueError `unclear` if GitHub cannot say.
 */
export async function findGithubIssue(
  id: number,
  since: Date,
  sent: { title: string; body: string }
): Promise<GithubIssue | null> {
  const start = new Date(since.getTime() - 5 * 60_000).toISOString();
  const deadline = Date.now() + SEARCH_DEADLINE_MS;
  let conflictingMarker = false;
  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GithubIssueError('unclear', 'The search took too long');
    const response = await request(
      `${issuesUrl()}?state=all&sort=created&direction=desc&per_page=${PAGE_SIZE}&page=${page}&since=${encodeURIComponent(start)}`,
      { method: 'GET' },
      Math.min(TIMEOUT_MS, remaining)
    );
    if (!response.ok)
      throw new GithubIssueError('unclear', `GitHub answered with ${response.status}`);
    const issues = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(issues))
      throw new GithubIssueError('unclear', 'GitHub sent an unreadable answer');
    for (const entry of issues as Record<string, unknown>[]) {
      if (entry.pull_request) continue;
      if (typeof entry.body !== 'string' || !containsIssueMarker(entry.body, id)) continue;
      if (entry.title === sent.title || entry.body.startsWith(sent.body.slice(0, 120))) {
        const found = toIssue(entry);
        if (!found) throw new GithubIssueError('unclear', 'GitHub sent an unreadable issue');
        return found;
      }
      conflictingMarker = true;
    }
    // Only the last page, a short one, proves that the issue is not there
    if (issues.length < PAGE_SIZE) {
      if (conflictingMarker)
        throw new GithubIssueError('needs-review', 'A report marker has conflicting issue content');
      return null;
    }
  }
  throw new GithubIssueError('unclear', 'Too many changed issues to search through');
}
