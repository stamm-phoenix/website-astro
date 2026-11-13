import assert from 'node:assert/strict';
import test from 'node:test';
import { ROUTES } from '../../api/test/fixtures/routes';
import { mockRouteTable } from '../dev/mockApi';
import { CONTENT_REVIEW_ROUTES } from '../dev/mockContentReview';

/**
 * The browser tests run against the demo API (`web/dev/mockApi.ts`), not against the real one.
 * This test compares both route tables, so the demo API cannot silently lose or invent an
 * endpoint. The real routes come from the snapshot that `api/test/routes.test.ts` keeps equal to
 * the `app.http` registrations of `api/endpoints`.
 */

/** Real routes the demo API deliberately does not serve. Each entry needs a reason. */
const NOT_IN_DEMO_API: Record<string, string> = {
  'POST /api/GetRoles':
    'Role function of the Static Web App login; the demo login brings its roles along.',
  'GET /api/protokoll-cutover-status': 'Not called by the web app, only by operations.',
  // Drift found when this test was written. Remove an entry when the demo API serves the route.
  'GET /api/intern/haeufig': 'Drift: StaffCommonTasks reads it, the demo API answers 404.',
  'POST /api/intern/haeufig': 'Drift: staffRecentStore sends it, the demo API answers 404.',
  'GET /api/intern/pflege/sammelbestellungen/orders/:p/payment':
    'Drift: SammelPaymentDialog reads it, sammel-payment.spec.ts stubs it in the browser.',
  'POST /api/intern/pflege/sammelbestellungen/orders/:p/payment':
    'Drift: SammelPaymentDialog sends it, sammel-payment.spec.ts stubs it in the browser.',
  'GET /api/intern/pflege/sammelbestellungen/orders/:p/payment/persons':
    'Drift: SammelPaymentDialog reads it, sammel-payment.spec.ts stubs it in the browser.',
  // The real `{id?}` allows every method with and without the id; the handler uses POST without
  // and PUT/DELETE with it, and the demo API registers exactly those pairs.
  'POST /api/intern/pflege/aufgaben/projekte/:p': 'Optional id: POST is the create without id.',
  'PUT /api/intern/pflege/aufgaben/projekte': 'Optional id: PUT is the update with id.',
  'DELETE /api/intern/pflege/aufgaben/projekte': 'Optional id: DELETE is the removal with id.',
  'POST /api/intern/pflege/aufgaben/vorlagen/:p': 'Optional id: POST is the create without id.',
  'PUT /api/intern/pflege/aufgaben/vorlagen': 'Optional id: PUT is the update with id.',
  // One demo route `:id/:art` answers both
  'POST /api/intern/pflege/schnupperanfragen/:p/bestaetigen':
    'Served by the demo route `:id/:art`.',
  'POST /api/intern/pflege/schnupperanfragen/:p/absagen': 'Served by the demo route `:id/:art`.',
};

/** Demo routes the real API does not have. Each entry needs a reason. */
const ONLY_IN_DEMO_API: Record<string, string> = {
  'POST /api/intern/pflege/schnupperanfragen/:p/:p':
    'Demo route `:id/:art` for bestaetigen and absagen.',
  'GET /api/mock/campflow-embed':
    'Stands in for the CampFlow form, which the browser loads from CampFlow.',
  'GET /api/intern/pflege/protokolle/:p/vorschau-demo': 'Demo document behind the minutes preview.',
  'PUT /api/mock-upload/:p': 'Target of the upload URLs the demo API hands out, like Blob Storage.',
  'GET /api/mock-fotos/vorschau/:p': 'Demo photo library, which is SharePoint in production.',
  'GET /api/mock-fotos/datei/:p': 'Demo photo library, which is SharePoint in production.',
  'PUT /api/mock-fotos/upload/:p': 'Demo photo library, which is SharePoint in production.',
  'GET /api/mock-fotos/upload/:p': 'Demo photo library, which is SharePoint in production.',
  // Resets for the browser tests; every test starts with fresh demo data
  'POST /api/__mock/protokolle/reset': 'Reset for the browser tests.',
  'POST /api/__mock/aufgaben/reset': 'Reset for the browser tests.',
  'POST /api/__mock/einstellungen/reset': 'Reset for the browser tests.',
  'POST /api/__mock/zuletzt/reset': 'Reset for the browser tests.',
  'POST /api/__mock/neuigkeiten/reset': 'Reset for the browser tests.',
  'POST /api/__mock/personen/reset': 'Reset for the browser tests.',
  'POST /api/__mock/inventur/reset': 'Reset for the browser tests.',
  'POST /api/__mock/abstimmungen/reset': 'Reset for the browser tests.',
};
/** `{id}`, `{id:int}` → `:p`; an optional `{id?}` stands for the path with and without it. */
function realPaths(route: string): string[] {
  const optional = /\/\{[^}]*\?\}$/.test(route);
  const base = route.replace(/\/\{[^}]*\?\}$/, '').replace(/\{[^}]*\}/g, ':p');
  const path = `/api/${base}`;
  return optional ? [path, `${path}/:p`] : [path];
}

function demoPath(path: string): string {
  return path.replace(/:\w+/g, ':p');
}

function keys(
  routes: { methods: string[]; path: string }[],
  paths: (path: string) => string[]
): Set<string> {
  return new Set(
    routes.flatMap((route) =>
      route.methods.flatMap((method) => paths(route.path).map((path) => `${method} ${path}`))
    )
  );
}

const real = keys(
  ROUTES.map((route) => ({ methods: route.methods, path: route.route ?? route.name })),
  realPaths
);
const demo = keys([...mockRouteTable(), ...CONTENT_REVIEW_ROUTES], (path) => [demoPath(path)]);

test('every real route is served by the demo API or listed with a reason', () => {
  const missing = [...real].filter((key) => !demo.has(key) && !(key in NOT_IN_DEMO_API));
  assert.deepEqual(missing, [], 'Add these routes to the demo API, or to NOT_IN_DEMO_API');
});

test('every demo route exists in the real API or is listed with a reason', () => {
  const extra = [...demo].filter((key) => !real.has(key) && !(key in ONLY_IN_DEMO_API));
  assert.deepEqual(
    extra,
    [],
    'Remove these routes from the demo API, or add them to ONLY_IN_DEMO_API'
  );
});

test('the lists of deliberate gaps contain no entry that has become obsolete', () => {
  const obsolete = [
    ...Object.keys(NOT_IN_DEMO_API).filter((key) => !real.has(key) || demo.has(key)),
    ...Object.keys(ONLY_IN_DEMO_API).filter((key) => !demo.has(key) || real.has(key)),
  ];
  assert.deepEqual(obsolete, []);
});
