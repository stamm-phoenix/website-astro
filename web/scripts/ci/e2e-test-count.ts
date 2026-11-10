/**
 * Counts the Playwright tests a source file declares, by parsing it (nothing is executed).
 *
 * Counted are declarations: `test(…)`, `test.only(…)` and the titled forms `test.skip/fixme/fail('title', fn)`,
 * also when they sit on one line inside `describe`, behind an alias (`import { test as t }`,
 * `const it = base.extend(…)`) or in a helper. Not counted: `test.describe`, `test.step`,
 * `test.slow()`, conditional `test.skip(cond, 'reason')`, hooks, comments and strings.
 *
 * A declaration inside a loop or `.forEach/.map` callback is one declared case, not one run per
 * entry. It is also reported in `looped`, so a PR that adds a loop cannot hide behind a zero delta.
 * Adding an entry to the array of an existing loop is not seen; review that by reading the diff.
 * The same holds for a helper that declares a test: it counts once, not once per call, and a
 * default import used as `test` (`import t from './fixtures'`) is not followed.
 */
import ts from 'typescript';

export interface Registrations {
  declared: number;
  looped: number;
}

const MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);
const TITLED_ONLY = new Set(['skip', 'fixme', 'fail', 'slow']);
const ITERATORS = new Set(['forEach', 'map', 'flatMap', 'reduce', 'from']);

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function chainOf(node: ts.Expression): { root: string; names: string[] } | undefined {
  const names: string[] = [];
  let current = unwrap(node);
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      names.unshift(current.name.text);
      current = unwrap(current.expression);
    } else if (
      ts.isElementAccessExpression(current) &&
      ts.isStringLiteralLike(current.argumentExpression)
    ) {
      names.unshift(current.argumentExpression.text);
      current = unwrap(current.expression);
    } else break;
  }
  return ts.isIdentifier(current) ? { root: current.text, names } : undefined;
}

function isStringLike(node: ts.Expression): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

/** Names that stand for Playwright's `test`: itself, imports of it under any name, `x.extend(…)`. */
function testRoots(file: ts.SourceFile): { roots: Set<string>; namespaces: Set<string> } {
  const roots = new Set(['test']);
  const namespaces = new Set<string>();
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
      const bindings = node.importClause.namedBindings;
      if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      else {
        for (const spec of bindings.elements) {
          if ((spec.propertyName ?? spec.name).text === 'test') roots.add(spec.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        const imported = element.propertyName ?? element.name;
        if (
          ts.isIdentifier(imported) &&
          imported.text === 'test' &&
          ts.isIdentifier(element.name)
        ) {
          roots.add(element.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let grew = true;
  while (grew) {
    grew = false;
    for (const declaration of declarations) {
      const name = (declaration.name as ts.Identifier).text;
      if (roots.has(name)) continue;
      let init = unwrap(declaration.initializer as ts.Expression);
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === 'mergeTests'
      ) {
        if (init.arguments.some((arg) => roots.has(chainOf(arg)?.root ?? ''))) {
          roots.add(name);
          grew = true;
        }
        continue;
      }
      while (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)) {
        if (init.expression.name.text !== 'extend') break;
        init = unwrap(init.expression.expression);
      }
      if (ts.isCallExpression(init)) continue;
      const chain = chainOf(init);
      const viaNamespace = chain && namespaces.has(chain.root) && chain.names[0] === 'test';
      if (chain && ((roots.has(chain.root) && chain.names.length === 0) || viaNamespace)) {
        roots.add(name);
        grew = true;
      }
    }
  }
  return { roots, namespaces };
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

export function countRegistrations(source: string, fileName = 'spec.ts'): Registrations {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const { roots, namespaces } = testRoots(file);
  const result: Registrations = { declared: 0, looped: 0 };
  const visit = (node: ts.Node, looped: boolean): void => {
    let inLoop = looped;
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
      if (declaresTest(node, roots, namespaces)) {
        result.declared += 1;
        if (inLoop) result.looped += 1;
      }
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && ITERATORS.has(callee.name.text)) inLoop = true;
    }
    ts.forEachChild(node, (child) => visit(child, inLoop));
  };
  visit(file, false);
  return result;
}
