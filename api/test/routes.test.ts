import assert from 'node:assert/strict';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { app } from '@azure/functions';
import { ROUTES, type RegisteredRoute } from './fixtures/routes';

interface HttpOptions {
  methods?: string[];
  authLevel?: string;
  route?: string;
}

// main.js registers once per process, so the routes are captured once for both tests
async function registeredRoutes(): Promise<RegisteredRoute[]> {
  const routes: RegisteredRoute[] = [];
  const http = mock.method(app, 'http', (name: string, options: HttpOptions) => {
    routes.push({
      name,
      methods: options.methods ?? [],
      authLevel: options.authLevel ?? '',
      route: options.route ?? null,
    });
  });
  await import(join(__dirname, '..', 'main.js'));
  http.mock.restore();
  return routes;
}

function overlaps(a: RegisteredRoute, b: RegisteredRoute): boolean {
  if (!a.methods.some((method) => b.methods.includes(method))) return false;
  const left = (a.route ?? a.name).split('/');
  const right = (b.route ?? b.name).split('/');
  const isParameter = (segment: string): boolean => /^\{.*\}$/.test(segment);
  return (
    left.length === right.length &&
    left.every((s, i) => s === right[i] || isParameter(s) || isParameter(right[i]))
  );
}

const captured = registeredRoutes();

test('main.ts registers exactly the functions of the snapshot', async () => {
  const routes = await captured;
  const byName = (a: RegisteredRoute, b: RegisteredRoute): number => a.name.localeCompare(b.name);
  assert.ok(routes.length > 250);
  assert.deepEqual([...routes].sort(byName), [...ROUTES].sort(byName));
});

test('routes that can match the same request keep their order of registration', async () => {
  const routes = await captured;
  const position = new Map(routes.map((route, index) => [route.name, index]));
  let pairs = 0;
  ROUTES.forEach((first, i) => {
    for (const second of ROUTES.slice(i + 1)) {
      if (!overlaps(first, second)) continue;
      pairs++;
      assert.ok(
        (position.get(first.name) ?? -1) < (position.get(second.name) ?? -1),
        `${first.name} must be registered before ${second.name}`
      );
    }
  });
  assert.ok(pairs > 0);
});
