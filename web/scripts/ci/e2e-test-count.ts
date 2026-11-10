/**
 * Counts the Playwright tests that source files declare, by parsing them (nothing is executed;
 * `playwright test --list` would load and run the PR's test code, so it is not used).
 *
 * Semantics: the number of declared cases, not the runs after Playwright expands them.
 * - Counted: `test(…)`, `test.only(…)` and the titled forms `test.skip/fixme/fail('title', fn)`,
 *   also several on one line, inside `describe`, behind aliases, default or renamed imports of a
 *   fixture module (see `e2e-test-roots.ts`) and in helpers.
 * - Not counted: `test.describe`, `test.step`, `test.slow()`, conditional `test.skip(cond, 'x')`,
 *   hooks, comments, strings.
 * - A declaration inside a loop or `.forEach/.map` callback is one declared case and also
 *   `looped`. Adding an entry to the array of an existing loop is not seen.
 * - A named function that declares tests is a helper: its declarations count once per reference
 *   (call, or passed as an argument, in any file), not once in the helper.
 * - `uncertain` marks places whose count cannot be known statically: `test` (or an alias) passed
 *   to a function, or `test[computed]`. A PR that adds one needs maintainer review like new tests.
 */
import ts from 'typescript';
import { chainOf, findRoots, unwrap } from './e2e-test-roots';
import type { ImportResolver } from './e2e-test-roots';

export interface Registrations {
  declared: number;
  looped: number;
  uncertain: number;
}

interface Weight {
  declared: number;
  looped: number;
}

export interface FileCounts extends Registrations {
  /** Declarations inside named functions, by function name. */
  helpers: Map<string, Weight>;
  /** Calls of, or arguments that are, identifiers: name → references (and how many in loops). */
  references: Map<string, { count: number; looped: number }>;
}

const MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);
const TITLED_ONLY = new Set(['skip', 'fixme', 'fail', 'slow']);
const ITERATORS = new Set(['forEach', 'map', 'flatMap', 'reduce', 'from']);

function isStringLike(node: ts.Expression): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

function declaresTest(
  call: ts.CallExpression,
  roots: Set<string>,
  namespaces: Set<string>
): boolean {
  const chain = chainOf(call.expression);
  if (!chain) return false;
  let { root, names } = chain;
  if (namespaces.has(root) && names[0] === 'test') {
    root = 'test';
    names = names.slice(1);
  }
  if (!roots.has(root) || names.some((name) => !MODIFIERS.has(name))) return false;
  const args = call.arguments;
  if (names.length === 0 || names.every((name) => name === 'only')) return args.length >= 2;
  if (!names.some((name) => TITLED_ONLY.has(name))) return false;
  return args.length >= 2 && isStringLike(args[0]);
}

/** The name of a function declaration, or of a variable initialised with a function. */
function functionName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(unwrap(node.initializer)) ||
      ts.isFunctionExpression(unwrap(node.initializer)))
  ) {
    return node.name.text;
  }
  return undefined;
}

export function analyzeFile(
  source: string,
  fileName = 'spec.ts',
  resolve?: ImportResolver
): FileCounts {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const { roots, namespaces } = findRoots(file, resolve);
  const result: FileCounts = {
    declared: 0,
    looped: 0,
    uncertain: 0,
    helpers: new Map(),
    references: new Map(),
  };
  const reference = (name: string, looped: boolean): void => {
    const entry = result.references.get(name) ?? { count: 0, looped: 0 };
    entry.count += 1;
    if (looped) entry.looped += 1;
    result.references.set(name, entry);
  };
  const visit = (node: ts.Node, looped: boolean, helper: string | undefined): void => {
    let inLoop = looped;
    let inHelper = helper;
    const own = functionName(node);
    if (own) inHelper = own;
    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      inLoop = true;
    }
    if (ts.isCallExpression(node)) {
      const iterated = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(iterated) && ITERATORS.has(iterated.name.text))
        inLoop = true;
      if (declaresTest(node, roots, namespaces)) {
        if (inHelper) {
          const weight = result.helpers.get(inHelper) ?? { declared: 0, looped: 0 };
          weight.declared += 1;
          if (inLoop) weight.looped += 1;
          result.helpers.set(inHelper, weight);
        } else {
          result.declared += 1;
          if (inLoop) result.looped += 1;
        }
      }
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) reference(callee.text, inLoop);
      for (const arg of node.arguments) {
        const value = unwrap(arg);
        if (ts.isIdentifier(value)) {
          reference(value.text, inLoop);
          if (roots.has(value.text)) result.uncertain += 1;
        }
      }
    }
    if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression)) {
      const target = unwrap(node.expression);
      if (ts.isIdentifier(target) && roots.has(target.text)) result.uncertain += 1;
    }
    ts.forEachChild(node, (child) => visit(child, inLoop, inHelper));
  };
  visit(file, false, undefined);
  return result;
}

/** Adds up files: helper declarations count once per reference to the helper in any file. */
export function totalRegistrations(files: FileCounts[]): Registrations {
  const total: Registrations = { declared: 0, looped: 0, uncertain: 0 };
  const helpers = new Map<string, Weight>();
  for (const file of files) {
    total.declared += file.declared;
    total.looped += file.looped;
    total.uncertain += file.uncertain;
    for (const [name, weight] of file.helpers) {
      const sum = helpers.get(name) ?? { declared: 0, looped: 0 };
      sum.declared += weight.declared;
      sum.looped += weight.looped;
      helpers.set(name, sum);
    }
  }
  for (const [name, weight] of helpers) {
    let references = 0;
    let looped = 0;
    for (const file of files) {
      const entry = file.references.get(name);
      if (entry) {
        references += entry.count;
        looped += entry.looped;
      }
    }
    total.declared += weight.declared * references;
    total.looped += weight.looped * references + (weight.declared - weight.looped) * looped;
  }
  return total;
}

/** Single file without cross-file imports; the budget uses `analyzeFile` for the whole tree. */
export function countRegistrations(source: string, fileName = 'spec.ts'): Registrations {
  return totalRegistrations([analyzeFile(source, fileName)]);
}
