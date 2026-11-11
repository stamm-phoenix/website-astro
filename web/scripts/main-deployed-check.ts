/**
 * Hourly check that main is deployed (job `main-deployed` in the main workflow): compares the
 * commit of the deployed site (`DEPLOYED_COMMIT`, from `content-check.ts`) with main and fails when
 * a push run left main undeployed, so a flaky test that blocks the deploy does not go unnoticed.
 * Never fails on its own problems (API errors only warn). Needs GITHUB_TOKEN and GITHUB_REPOSITORY.
 */
import { decideMainDeployed, type MainCommit } from './main-deployed';

const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const REPOSITORY = process.env.GITHUB_REPOSITORY ?? '';
const WORKFLOW_FILE = 'azure-static-web-apps-zealous-water-04f606303.yml';

async function github(path: string): Promise<unknown> {
  const response = await fetch(`${API}/repos/${REPOSITORY}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${path} answered with ${response.status}`);
  return response.json();
}

async function readCommits(): Promise<MainCommit[] | null> {
  try {
    const body = (await github('/commits?sha=main&per_page=30')) as {
      sha: string;
      commit: { message: string };
    }[];
    return body.map((entry) => ({ sha: entry.sha, message: entry.commit.message }));
  } catch (error: unknown) {
    console.warn(error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function readPushRunActive(): Promise<boolean | null> {
  try {
    const body = (await github(
      `/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&event=push&per_page=20`
    )) as { workflow_runs: { status: string }[] };
    return body.workflow_runs.some((run) => run.status !== 'completed');
  } catch (error: unknown) {
    console.warn(error instanceof Error ? error.message : String(error));
    return null;
  }
}

const outcome = decideMainDeployed({
  deployed: process.env.DEPLOYED_COMMIT ?? '',
  commits: await readCommits(),
  pushRunActive: await readPushRunActive(),
});
if (outcome.status === 'not-deployed') {
  console.log(`::error title=main ist nicht ausgerollt::${outcome.reason}`);
  process.exit(1);
}
if (outcome.status === 'unknown') console.log(`::warning::${outcome.reason} No check was made.`);
else console.log(outcome.reason);
