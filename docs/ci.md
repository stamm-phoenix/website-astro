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
- Shards (`browser-matrix.ts`, `browser-shards.ts`): the fewest Chromium shards (1 to 16) whose estimated wall time stays within 85 s, which with about 60 s for container, install, build and report keeps a shard job at about 2:30 min. A shard gets whole project/files, the longest first, each where the estimate ends lowest. The estimate replays what Playwright does: project, file by name, the tests of each file in their order, each test on the next free of 4 workers; a file's seconds are split evenly over its tests (counted by the discovery of the run). Six workers were not faster: on the 4 vCPUs of a runner each test took about 26 % longer (run 43002290029).
- WebKit (`webkit-tablet`): one job `Browser tests (WebKit)`, 1 worker, only when one of its specs is selected.
- Every shard builds the site with the test data (`CONTENT_SOURCE=mock`, `CONTENT_STRICT=1`, about 10 s) and tests against the build: `E2E_SERVER=built` starts one `scripts/serve-built.ts --fresh-state` per worker (`dist/` with the demo API of `web/dev/mockApi.ts` and the routes of `staticwebapp.config.json`), with nothing to compile. A shared build job was not faster: it takes longer than `Select browser tests`, which the shards wait for anyway.
- Fresh demo data per test: the server answers `/api/*` and `/.auth/*` from an instance of the demo API in a worker thread with its own module graph (`scripts/mock-instance.ts`). The auto fixture `freshDemoData` (`tests/fixtures.ts`) calls `POST /__e2e/fresh-state` before every test and every retry; the server then switches to an instance it has already loaded (`scripts/mock-state.ts`). One server belongs to one Playwright worker, which runs one test at a time, so every page, second browser context and API request of a test sees the same data and no other test. Therefore `fullyParallel` is on and the tests of a file spread over the workers. A test must not rely on what an earlier test wrote. On the dev server (local default) the tests of a file still share their server's data and run one after the other.
- Tests tagged `@dev-server` load source modules of the dev server (`import('/src/lib/…')`); the build leaves them out, and the job `Browser tests (dev server)` runs them on the dev server when their files are selected (the file names are in its `if`). Do not add such tests; test a module with `bun test` or through the page instead. `bun test` compiles `*.svelte.ts` modules with runes through the preload `web/test/setup/svelte-runes.ts` (`web/bunfig.toml`), so a store can be imported directly; `web/test/setup/changelog-entries.ts` does the same for `changelogEntries.ts`, which collects its files with `import.meta.glob` (Vite only), and `web/test/fixtures/fetch-stub.ts` replaces `fetch` so a test can hold an answer back and let it arrive late.
- No affected spec means no browser job; `Browser tests` still passes.
- `web/scripts/ci/browser-durations.tsv` (`project<TAB>file<TAB>seconds<TAB>tests`) holds the seconds and the number of tests per project/file, measured under full load (4 workers, `fullyParallel`). Files not listed get the median. To refresh, download the reports of a few full runs into one folder each (`gh run download <run> -p 'browser-report-*' -D runs/<run>`) and run `bun scripts/ci/browser-durations.ts runs/<run1> runs/<run2> … > scripts/ci/browser-durations.tsv` in `web/`, then `bun test test/browser-matrix.test.ts test/browser-shards.test.ts test/browser-durations.test.ts`. A new spec needs no entry; update the file only when shards are visibly unbalanced.
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

## Lessons from building this pipeline

Rules that came out of real failures in November 2026 (#555, #530, #570). Follow them; each one cost a red run or a wrong claim.

### Measuring and claiming

- Measure on CI, never estimate. Predictions of shard times were off by up to 60 % (#590, #593); the plan for #530 expected 18 and 23 removed tests where 8 and 17 were possible. Put the run ID next to every number, and say when a number comes from one run.
- Report test seconds, not test counts. Removing one test saved about 100 s (#604), removing fifteen saved almost nothing (#599).
- A file-level estimate cannot predict a shard: long files that run side by side slow each other down by 5 to 47 %, and each worker's server start adds a fixed cost. Only state per test with `fullyParallel` removed that floor (#598).
- "Passed locally" is no evidence for browser behaviour: agents on the dev machine have no browser. Say which checks ran and where. Push, read the PR run, then claim.
- Do not end a turn to say you are waiting for CI. Wait with `gh run watch <id>`, or hand back with the PR and what is unverified.

### Flaky and red tests

- One red test throws a PR out of the merge queue, so a flaky test blocks everybody. Fix it first, in its own PR.
- A test that fails in both attempts is usually not random: before #598 the retry ran on the same demo data the failed attempt left behind. Read the trace before you call it flaky.
- Wait for the condition, not for stillness or time. The favourites helper pressed where the list had been, because cards above it were still loading; the fix scrolls until `document.elementFromPoint` at the press point belongs to the target (#596).
- A dialog titled after a field changes its name when the test types into that field. Take the locator after the edit (#601).
- Repeating a spec on one server (`browser-benchmark.yml`, `repeat_each`) fails tests that create a record with a fixed name. That is an artefact of repeating, not a flake (#597).
- The built site exposes what the dev server hides: the build with test data had baked no content for two weeks because a path was only right under Vite (#594). When a spec only passes on the dev server, find out why before you tag it `@dev-server`.

### Shrinking the browser suite (#530)

- About 470 of the tests check what only a browser shows (touch, focus, service worker, downloads, layout, a second browser context). Do not aim at a test count.
- First choice: prepare the state through the demo API instead of clicking through pages, and keep one test per flow that really clicks through the creation. Every test starts with fresh demo data, so this is safe.
- Move a test to `bun test` only when its logic lives in a store or module. `web/bunfig.toml` preloads what `bun test` needs for `*.svelte.ts` stores and for `import.meta.glob`.
- When the logic sits in a `.svelte` component, moving it out is a refactoring of the component. Do it only as a behaviour-neutral move that a remaining browser test of that flow verifies.
- Never leave a gap. If removing a test leaves the wiring of a component (a prop passed, a handler called) without any test, keep the shortest browser test that proves it: one run instead of a loop, only the assertions for the wiring.
- The PR description has a table "removed test or group → protection now", and every new unit test file is broken once on purpose to see it fail.

### Working with the merge queue

- `gh pr merge <n> --auto` (the queue sets the method; `--rebase` only prints a notice) enqueues the PR as soon as its required checks are green. Use it instead of polling.
- A push to a queued PR takes it out of the queue. Put follow-ups (a changelog entry the reviewer asks for) into the PR before you enqueue, or into a new PR.
- After a queue merge `main` runs only build and deploy. A red queue run means the PR is out; nothing reached `main`.
- Without required checks in the ruleset the queue merges at once. The ruleset is Hugo's; check it with `gh api repos/stamm-phoenix/website-astro/rules/branches/main`, never change it.

### Delegating CI work to agents

- Give each agent its own spec files or its own workflow. Two PRs that both regenerate `browser-durations.tsv` or renumber shards conflict.
- An agent's report is a claim. Read the diff and the PR run before merging; twice a report said a check had passed that had not run.
- Review what a PR removes harder than what it adds: gaps in protection are named in the description only when you ask for them.
