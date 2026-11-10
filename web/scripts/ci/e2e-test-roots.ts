/**
 * Which names in a Playwright file stand for `test`, and which names a file exports that do.
 * Used by `e2e-test-count.ts`. Nothing is executed: files are only parsed.
 *
 * A name is a root when it is `test` itself, an import of `test` under any name, `x.extend(…)`
 * or `mergeTests(…)` of a root, `const { test: t } = require(…)`, or an import whose export in a
 * relative module is itself a root (default or renamed, e.g. `export default base.extend({})`,
 * `export const myTest = base.extend({})`, `export { test as it } from './fixtures'`). Imports from
 * packages other than the relative modules we can read are only followed by the name `test`.
 */
import ts from 'typescript';

export interface ExportedRoots {
  default: boolean;
  named: Set<string>;
}

/** Resolves an import specifier of the current file to what that module exports as `test`. */
export type ImportResolver = (specifier: string) => ExportedRoots | undefined;

export interface Roots {
  roots: Set<string>;
  namespaces: Set<string>;
}

export function unwrap(node: ts.Expression): ts.Expression {
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

export function chainOf(node: ts.Expression): { root: string; names: string[] } | undefined {
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

/** True when the expression is a root, a namespace `ns.test`, or `<root>.extend(…)` chains of it. */
function isRootExpression(
  node: ts.Expression,
  roots: Set<string>,
  namespaces: Set<string>
): boolean {
  let init = unwrap(node);
  if (
    ts.isCallExpression(init) &&
    ts.isIdentifier(init.expression) &&
    init.expression.text === 'mergeTests'
  ) {
    return init.arguments.some((arg) => isRootExpression(arg, roots, namespaces));
  }
  while (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)) {
    if (init.expression.name.text !== 'extend') return false;
    init = unwrap(init.expression.expression);
  }
  if (ts.isCallExpression(init)) return false;
  const chain = chainOf(init);
  if (!chain) return false;
  if (namespaces.has(chain.root)) return chain.names.length === 1 && chain.names[0] === 'test';
  return roots.has(chain.root) && chain.names.length === 0;
}

export function findRoots(file: ts.SourceFile, resolve?: ImportResolver): Roots {
  const roots = new Set(['test']);
  const namespaces = new Set<string>();
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const exported = resolve?.(node.moduleSpecifier.text);
      const { name, namedBindings } = node.importClause;
      if (name && exported?.default) roots.add(name.text);
      if (namedBindings && ts.isNamespaceImport(namedBindings))
        namespaces.add(namedBindings.name.text);
      else if (namedBindings) {
        for (const spec of namedBindings.elements) {
          const imported = (spec.propertyName ?? spec.name).text;
          if (imported === 'test' || exported?.named.has(imported)) roots.add(spec.name.text);
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
      if (roots.has(name) || !declaration.initializer) continue;
      if (isRootExpression(declaration.initializer, roots, namespaces)) {
        roots.add(name);
        grew = true;
      }
    }
  }
  return { roots, namespaces };
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** What a module exports that is a root, so importers can follow default and renamed imports. */
export function exportedRoots(
  file: ts.SourceFile,
  found: Roots,
  resolve?: ImportResolver
): ExportedRoots {
  const result: ExportedRoots = { default: false, named: new Set() };
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && found.roots.has(declaration.name.text)) {
          result.named.add(declaration.name.text);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (isRootExpression(statement.expression, found.roots, found.namespaces))
        result.default = true;
    } else if (ts.isExportDeclaration(statement) && statement.exportClause === undefined) {
      const from =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolve?.(statement.moduleSpecifier.text)
          : undefined;
      from?.named.forEach((name) => result.named.add(name));
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const from =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolve?.(statement.moduleSpecifier.text)
          : undefined;
      for (const spec of statement.exportClause.elements) {
        const local = (spec.propertyName ?? spec.name).text;
        const isRoot = statement.moduleSpecifier
          ? (from?.named.has(local) ?? false) || (local === 'default' && !!from?.default)
          : found.roots.has(local);
        if (!isRoot) continue;
        if (spec.name.text === 'default') result.default = true;
        else result.named.add(spec.name.text);
      }
    }
  }
  return result;
}
