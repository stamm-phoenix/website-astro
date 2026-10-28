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

const TIMEOUT_MS = 15_000;

export interface GithubIssue {
  number: number;
  url: string;
}

/**
 * Why no issue was created. `unclear` means the request may have been processed anyway (no
 * answer, a server error): check before trying again.
 */
export type GithubIssueFailure = 'not-configured' | 'preview' | 'rejected' | 'unclear';

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

async function request(url: string, init: RequestInit): Promise<Response> {
  const blocked = githubIssuesUnavailable();
  if (blocked) throw new GithubIssueError(blocked, `GitHub issues unavailable: ${blocked}`);
  try {
    return await fetch(url, {
      ...init,
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
 * @throws GithubIssueError `unclear` if GitHub cannot say.
 */
export async function findGithubIssue(id: number, since: Date): Promise<GithubIssue | null> {
  const start = new Date(since.getTime() - 5 * 60_000).toISOString();
  const response = await request(
    `${issuesUrl()}?state=all&sort=created&direction=desc&per_page=100&since=${encodeURIComponent(start)}`,
    { method: 'GET' }
  );
  if (!response.ok)
    throw new GithubIssueError('unclear', `GitHub answered with ${response.status}`);
  const issues = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(issues))
    throw new GithubIssueError('unclear', 'GitHub sent an unreadable answer');
  for (const entry of issues as Record<string, unknown>[]) {
    if (entry.pull_request) continue;
    if (typeof entry.body === 'string' && containsIssueMarker(entry.body, id))
      return toIssue(entry);
  }
  return null;
}
