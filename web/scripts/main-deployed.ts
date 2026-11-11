/**
 * Decision of the hourly check "is main deployed?" (job `main-deployed` in
 * `.github/workflows/azure-static-web-apps-zealous-water-04f606303.yml`), without any I/O so it
 * can be unit-tested. `scripts/main-deployed-check.ts` reads the inputs and calls it.
 */

export interface MainCommit {
  sha: string;
  message: string;
}

export interface MainDeployedInput {
  /** Commit the live site was built from; empty when the site does not tell. */
  deployed: string;
  /** Newest commits of main, newest first; null when the API could not be read. */
  commits: MainCommit[] | null;
  /** Whether a push run of the workflow for main is queued or in progress; null when unknown. */
  pushRunActive: boolean | null;
}

export type MainDeployedOutcome =
  | { status: 'ok'; reason: string }
  | { status: 'pending'; reason: string }
  | { status: 'unknown'; reason: string }
  | { status: 'not-deployed'; reason: string; deployed: string; expected: string };

/** The workflow never runs for such commits (nightly flake lock update), so they never deploy. */
export function skipsCi(message: string): boolean {
  return /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i.test(message);
}

const short = (sha: string): string => sha.slice(0, 8);

export function decideMainDeployed(input: MainDeployedInput): MainDeployedOutcome {
  const { deployed, commits, pushRunActive } = input;
  if (!/^[0-9a-f]{40}$/.test(deployed)) {
    return { status: 'unknown', reason: 'The deployed site does not name its commit.' };
  }
  if (!commits || commits.length === 0 || pushRunActive === null) {
    return { status: 'unknown', reason: 'The commits or runs of main could not be read.' };
  }
  const expectedIndex = commits.findIndex((commit) => !skipsCi(commit.message));
  if (expectedIndex < 0) {
    return { status: 'unknown', reason: 'No recent commit of main is deployable.' };
  }
  const expected = commits[expectedIndex].sha;
  const deployedIndex = commits.findIndex((commit) => commit.sha === deployed);
  // Newer than (or equal to) the newest deployable commit: only [skip ci] commits are missing
  if (deployedIndex >= 0 && deployedIndex <= expectedIndex) {
    return { status: 'ok', reason: `${short(deployed)} is the newest deployable commit.` };
  }
  if (pushRunActive) {
    return {
      status: 'pending',
      reason: `main (${short(expected)}) is still being deployed; the deployed commit is ${short(deployed)}.`,
    };
  }
  return {
    status: 'not-deployed',
    reason:
      `main is not deployed: the live site is built from ${short(deployed)}, main is at ` +
      `${short(expected)} and no push run is still running. Re-run the failed push run of ` +
      `${short(expected)} or push a fix to main.`,
    deployed,
    expected,
  };
}
