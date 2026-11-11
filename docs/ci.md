# CI and merging

How to work with the pipeline as an agent. Main workflow: `.github/workflows/azure-static-web-apps-zealous-water-04f606303.yml` (called "Azure Static Web Apps CI/CD"); it calls `check-api.yml`, `check-api-static.yml`, `browser-tests.yml` and `prepare-preview.yml`.

## Triggers

| Event                           | What runs                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pull_request`                  | Plan, tests selected by the plan, PR preview. `closed`: cleanup only.                                  |
| `merge_group` (merge queue)     | Plan (runs everything), all tests, no preview, no deploy.                                              |
| `push` to `main`                | Plan, tests unless the queue tested this commit, then `Deploy`.                                        |
| `schedule` (hourly), dispatch   | Content refresh (`content-*` jobs), `Check that main is deployed`. See `docs/eingebackene-inhalte.md`. |
| `E2E budget` (`e2e-budget.yml`) | PRs and merge groups.                                                                                  |

Commits with `[skip ci]` in the message never run the main workflow.

## Plan job and required checks

The job `Plan` (`web/scripts/ci/job-plan.ts`, run by `plan-jobs.ts`) decides from the diff against `HEAD^1`. Outputs: `web`, `api_tests`, `api_package`, `browser`, `preview`, `queue_tested`; the reason is printed in the job log (`Plan: …`).

| Changed paths                                                         | Result                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| only `docs/**` or `*.md`                                              | nothing runs (no preview either)                                     |
| `.github/**`, any `package.json`, `bun.lock`, `flake.*`, `scripts/**` | everything                                                           |
| `api/**` or `infrastructure/**`                                       | website, API tests, API package build, browser, preview              |
| anything else                                                         | website, browser, preview; API tests skipped, API package from cache |
| unreadable or empty diff, any event except PR/push                    | everything (fails open)                                              |

Three checks are the ones to require: **`Build`**, **`Browser tests`**, **`E2E budget`**.

- `Build` gates `Build website`, `Check website`, both `api` jobs; `Browser tests` gates the shard jobs. Both always report, also when the plan deselected their jobs (deselected counts as passed). A failed job, a skipped job the plan wanted, or a cancelled job (timeout, manual cancel) fails them. Cancelled jobs pass only when a newer state replaced the run.
- Never make a single shard or job name (`Browser tests (3/10)`, `api / Check API tests (1/3)`) required: shards change with the diff.
- `E2E budget` fails a PR that adds Playwright tests or spec files without the label `e2e-ok`. Never set that label yourself (`AGENTS.md`, "Welche Testebene?"). In a merge group it passes without counting.

## A check is red

1. `gh pr checks <n>` or `gh run view <id>`; open the failed job.
2. Browser shard: the step summary "List failed and flaky tests" (`flaky-summary.ts`) lists tests that failed in all attempts (failed) and tests that passed after a retry (flaky). The report is also the artifact `browser-report-*` (7 days).
3. Re-run only the failed jobs: `gh run rerun <run-id> --failed`. Do this for a failure you can tie to infrastructure or a known flaky test, not instead of reading the log.
4. Playwright retries once in CI. A flaky test is reported, not hidden: find the cause (race, shared state, waiting on time) and fix that. Do not raise timeouts blindly.
5. Quota, network and runner failures are not code failures; say so in the report.

## Browser tests

- `Select browser tests` (`select-browser-shards.ts`) lists all specs of the projects `desktop`, `mobile`, `webkit-tablet` and, on PRs, keeps only affected specs (`affected-specs.ts`): a page is affected when a changed file is in its import closure; a spec when it or a helper it imports changed, or it names the route of an affected page. A spec naming no route always runs. Config, packages, public files, the mock API, CI scripts and files no page imports select everything. `main` and merge groups run everything.
- Shards (`browser-matrix.ts`): the fewest Chromium shards (1 to 12) whose estimated wall time stays at about 150 s, or the length of their longest file (a file never splits); then the target is lowered in 5 s steps while that count still fits. The estimate replays Playwright's order (project, name, 4 workers). Whole project/files stay together because the mock server's tests are sequential.
- WebKit (`webkit-tablet`): one job `Browser tests (WebKit)`, 1 worker, only when one of its specs is selected.
- Every shard builds the site with the test data (`CONTENT_SOURCE=mock`, `CONTENT_STRICT=1`, about 10 s) and tests against the build: `E2E_SERVER=built` starts one `scripts/serve-built.ts` per worker (`dist/` with the demo API of `web/dev/mockApi.ts` and the routes of `staticwebapp.config.json`), with nothing to compile or warm up. A shared build job was not faster: it takes longer than `Select browser tests`, which the shards wait for anyway.
- Tests tagged `@dev-server` load source modules of the dev server (`import('/src/lib/…')`); the build leaves them out, and the job `Browser tests (dev server)` runs them on the dev server when their files are selected (the file names are in its `if`). Do not add such tests; test a module with `bun test` or through the page instead.
- No affected spec means no browser job; `Browser tests` still passes.
- `web/scripts/ci/browser-durations.tsv` (`project<TAB>file<TAB>seconds`) holds the seconds per project/file. Files not listed get the median. There is no script to update it: PR #590 took the mean of three full runs from their Playwright reports. To refresh: take per-file durations of several recent full runs (main or CI-change PRs), average them, keep the format, run `bun test test/browser-matrix.test.ts test/browser-shards.test.ts` in `web/`. A new spec needs no entry; update the file only when shards are visibly unbalanced.
- Run locally for one spec: `bun run test:e2e --project=desktop tests/<name>.spec.ts` in `web/` (dev server); like CI: `bun run build`, then `E2E_SERVER=built bun run test:e2e …`.

## API tests

- `api / Check API tests (1/3)` to `(3/3)` in `check-api.yml`: three jobs, each with its own SQL Server 2022 service (`TEST_SQL_PASSWORD` set in the job).
- `api/scripts/ci/test-shard.mjs` picks the compiled `dist/test/*.test.js` files: sorted `api/test/*.test.ts`, round-robin separately for files that match `fixtures/database` and for the rest. A new test file needs no list; keep it directly in `api/test/`, named `*.test.ts`. Test the script with `node --test scripts/ci/test-shard.test.mjs`.
- `api / Check API static` (`check-api-static.yml`) lints, validates Bicep and packages, and produces the artifact `swa-api`. Without `api/**` changes a PR restores the package from the cache that pushes to `main` saved (key: hash of `api/**` without tests, `scripts/package-swa-api.sh`, the workflow); merge groups save none.

## PR preview

- `Prepare preview database` and `Deploy preview` run on PRs from this repository that are not opened by bots. They wait for `Build website`, `api / Check API static` and the database, not for the tests: a red test does not delay the preview.
- Each PR has its own database `website-pr-<n>` and blob container `pr-<n>`; `reset-preview-db` as label recreates the database (`preview-db-reset.yml`).
- Everything touching one preview shares the concurrency group `website-astro-preview-pr-<n>` (no cancel); production shares `website-astro-production`. Build and test jobs have a group per PR (or shard) and a newer push cancels them.
- On close: `Close Pull Request` drops the database and removes the login callback; `Cache cleanup` deletes the Actions caches of the PR.
- Upload logic is the composite action `.github/actions/swa-upload`; it runs inside the calling job because the Static Web App accepts OIDC only from the main workflow file.

## Merging

- `main` uses a merge queue. Merge with `gh pr merge <n> --auto --rebase`. The queue creates a `merge_group` run on the PR on top of the current `main`; when its required checks pass the PR is rebased onto `main`.
- Do not rebase a PR just because `main` moved on. Rebase only for a real conflict (`git push --force-with-lease`).
- If the queue run fails the PR leaves the queue. Read the failed job as above, push a fix (or re-run failed jobs for a flaky test), and enqueue again with the same command.
- After a queue merge the push to `main` runs `Plan` with `queue_tested=true` if a successful `merge_group` run exists for exactly that commit (`queue-run.ts`; waits up to about 2 minutes for a still running one): API tests and browser tests are skipped, `Build website`, the API package (cache) and `Deploy` still run. Without a match, or on any lookup error, everything runs.
- Dependabot PRs (weekly, `.github/dependabot.yml`) go through the same path; they get no preview.

## After the merge

- `Deploy` (production, after `Build` and `Browser tests` passed or were deselected by `queue_tested`) skips itself when a newer push run already deployed. Then `Deploy Azure task timer` runs if configured.
- Hourly (04:17 to 21:17 UTC) `Check that main is deployed` compares the commit in `/content-version.json` of the live site with `main` (`web/scripts/main-deployed*.ts`). Outcomes: ok; pending (a push run is still active); not-deployed (error "main ist nicht ausgerollt": the newest deployable commit is not live and no run is active, usually a red check on the push run); unknown (warning, no check made). `[skip ci]` commits (e.g. the nightly `flake.lock` update of `update-lockfiles.yml`) never count.
- Never claim a change is live before checking the push run of the head SHA.

## Changing the pipeline

- The main workflow stays in its file: the Static Web App accepts OIDC deploys only from the workflow named after it.
- Every job has `timeout-minutes`.
- Validate: `nix shell nixpkgs#actionlint -c actionlint` (repo root).
- Logic goes into scripts under `web/scripts/ci/` with tests in `web/test/` (`node:test` and `node:assert/strict`, run by `bun test test/`), not into inline shell.
- Changing `.github/**` makes the plan run everything, so that PR shows real timings.
- Never change rulesets or repository settings, never set the label `e2e-ok`, never make a shard required.

## Local equivalents

`bun` may be missing from `PATH`: prefix with `nix develop -c`.

| CI check                 | Locally                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `Build website`          | `bun run build` in `web/`                                               |
| `Check website`          | `bun run check` in `web/` (lint, astro check, svelte-check, unit tests) |
| `api / Check API static` | `bun run build` and `bun run lint` in `api/`                            |
| `api / Check API tests`  | `TEST_SQL_PASSWORD=… bun run test` in `api/` (needs a SQL Server)       |
| `Browser tests`          | `bun run test:e2e …` in `web/`, only the affected specs                 |
| `E2E budget`             | `bun scripts/ci/e2e-budget.ts <base> HEAD` in `web/`                    |
| CI script tests          | `bun test test/job-plan.test.ts …` in `web/`                            |
