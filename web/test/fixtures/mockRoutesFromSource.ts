import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Reads the routes of the demo API from the source of `web/dev/*.ts` instead of importing it: the
 * mock modules import validators of the API (zod, kysely), which the web job does not install.
 * `route(methods, path, handler)` calls are found in the syntax tree. Paths may use constants of
 * the file (`const BASE = '/api/…'`) and the loop variable of a `for (const x of ['a', 'b'])`.
 * Anything else throws, so a route written in a new way is never silently missed.
 * `test/demo-api-routes.test.ts` is where the result is compared with the real API.
 */
export interface DemoRoute {
  methods: string[];
  path: string;
}

type Scope = Map<string, string[]>;

function literals(node: ts.Expression): string[] | null {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
    return literals(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map((element) => literals(element));
    return values.every((value) => value?.length === 1) ? values.map((value) => value![0]) : null;
  }
  return null;
}

function expand(node: ts.Expression, scope: Scope): string[] | null {
  if (ts.isTemplateExpression(node)) {
    let results = [node.head.text];
    for (const span of node.templateSpans) {
      const values = expand(span.expression, scope);
      if (!values) return null;
      results = results.flatMap((prefix) =>
        values.map((value) => prefix + value + span.literal.text)
      );
    }
    return results;
  }
  if (ts.isIdentifier(node)) return scope.get(node.text) ?? null;
  const single = literals(node);
  return single && !ts.isArrayLiteralExpression(node) ? single : null;
}

function fileRoutes(file: string): DemoRoute[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const constants: Scope = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer && expand(declaration.initializer, constants);
      if (ts.isIdentifier(declaration.name) && value) constants.set(declaration.name.text, value);
    }
  }

  const found: DemoRoute[] = [];
  const visit = (node: ts.Node, scope: Scope): void => {
    let inner = scope;
    if (
      ts.isForOfStatement(node) &&
      ts.isVariableDeclarationList(node.initializer) &&
      ts.isIdentifier(node.initializer.declarations[0].name)
    ) {
      const values = literals(node.expression);
      if (values) inner = new Map(scope).set(node.initializer.declarations[0].name.text, values);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'route'
    ) {
      const [methodArg, pathArg] = node.arguments;
      const methods = methodArg && literals(methodArg);
      const paths = pathArg && expand(pathArg, inner);
      if (!methods || !paths) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        throw new Error(
          `${file}:${line + 1}: route() with a method or path this reader cannot resolve`
        );
      }
      for (const path of paths) found.push({ methods, path });
    }
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(source, constants);
  return found;
}

/** Every route registered with `route()` in `web/dev` (the folder is relative to `web/`). */
export function demoRoutesFromSource(
  directory = fileURLToPath(new URL('../../dev', import.meta.url))
): DemoRoute[] {
  const files = (readdirSync(directory, { recursive: true }) as string[]).filter((name) =>
    name.endsWith('.ts')
  );
  return files.flatMap((name) => fileRoutes(join(directory, name)));
}
