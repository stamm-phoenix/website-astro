// Runs the Claude review with the Claude Agent SDK and writes the findings as JSON to the step
// output `review`.
//
// The review used to run with anthropics/claude-code-action. That action identifies itself as
// Claude Code, and the promotional API credit of our organisation does not cover Claude Code; the
// Agent SDK it does. The setup is the same: Claude has only the reading tools, reads only the
// checkout and the PR files fetched by the workflow (a hook refuses every other path), loads no
// settings, hooks or MCP servers from the repo (the checkout is the PR's code) and returns the
// result in the schema of the prompt.
//
// Usage: node claude-review.mjs (in the checkout; installed next to the SDK, see the workflow)
// Environment: ANTHROPIC_API_KEY, MODEL, REVIEW_PROMPT, REVIEW_SCHEMA (JSON), PR_DIR,
// GITHUB_OUTPUT. Claude's messages are not logged (they may quote anything it read); only the
// cost, the number of turns and refused tool calls, and the API's reason when the run fails.

import { appendFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

const { ANTHROPIC_API_KEY, MODEL, REVIEW_PROMPT, REVIEW_SCHEMA, PR_DIR, GITHUB_OUTPUT } = process.env;

// The reading tools may read anywhere on the runner without approval (e.g. the runner's
// credentials or other files in RUNNER_TEMP), so a hook allows them only in the checkout and
// PR_DIR. Paths are resolved through symlinks, which a PR could add.
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const ROOTS = [real(process.cwd()), real(PR_DIR)];
const inside = (p) => {
  // The tools expand ~ to the home directory, path.resolve does not
  if (p.startsWith('~')) return false;
  const target = real(path.resolve(process.cwd(), p));
  return ROOTS.some((root) => target === root || target.startsWith(root + path.sep));
};
// A glob pattern must stay below the directory it is applied to
const relativePattern = (pattern) =>
  pattern === undefined ||
  (!path.isAbsolute(pattern) && !pattern.startsWith('~') && !pattern.split(/[\\/]/).includes('..'));
const readable = (tool, input) => {
  if (tool === 'Read') return typeof input.file_path === 'string' && inside(input.file_path);
  if (!inside(input.path ?? '.')) return false;
  if (tool === 'Glob') return relativePattern(input.pattern);
  if (tool === 'Grep') return relativePattern(input.glob);
  return false;
};

const run = query({
  prompt: REVIEW_PROMPT,
  options: {
    model: MODEL,
    cwd: process.cwd(),
    additionalDirectories: [PR_DIR],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // The only built-in tools Claude has; no shell, no network
    tools: ['Read', 'Grep', 'Glob'],
    // Reading only in the checkout and PR_DIR (see readable); the deny rules and refusing any
    // approval are a second line, e.g. for /proc/self/environ with the key
    hooks: {
      PreToolUse: [
        {
          matcher: 'Read|Grep|Glob',
          hooks: [
            async (input) =>
              readable(input.tool_name, input.tool_input)
                ? {}
                : {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse',
                      permissionDecision: 'deny',
                      permissionDecisionReason: 'Nur das Repo und die PR-Dateien lesen.',
                    },
                  },
          ],
        },
      ],
    },
    canUseTool: async () => ({ behavior: 'deny', message: 'Nur das Repo und die PR-Dateien lesen.' }),
    disallowedTools: ['Read(//proc/**)', 'Read(//sys/**)', 'Read(//etc/**)', 'Read(//home/runner/.*/**)'],
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    outputFormat: { type: 'json_schema', schema: JSON.parse(REVIEW_SCHEMA) },
    // Replaces the environment of the Claude process, so it does not get the GitHub token
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY },
  },
});

let result;
try {
  for await (const message of run) {
    if (message.type === 'result') result = message;
  }
} catch (error) {
  // An error result (e.g. a refused API call: credit, rate limit) ends the iteration with an error
  // that names the API's reason
  console.error(`The review failed: ${error.message}`);
  process.exit(1);
}

if (!result) {
  console.error('The run ended without a result.');
  process.exit(1);
}
const cost = result.total_cost_usd?.toFixed(2) ?? '?';
console.log(`${MODEL}: ${result.num_turns} turns, ${cost} $, ${result.permission_denials?.length ?? 0} refused tool calls`);
if (result.subtype !== 'success' || result.is_error || result.structured_output === undefined) {
  // For a refused API call (credit, rate limit) this is the API's reason
  console.error(`The review failed (${result.subtype}): ${result.result ?? result.errors?.join('; ') ?? ''}`);
  process.exit(1);
}

const json = JSON.stringify(result.structured_output);
appendFileSync(GITHUB_OUTPUT, `review<<REVIEW_JSON_END\n${json}\nREVIEW_JSON_END\n`);
