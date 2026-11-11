// The `mobile` project (Pixel 7: touch, narrow screen) runs only what is about phones; every
// other test is a generic flow and runs once, on `desktop`. Two ways to put something on `mobile`:
//
// - A single test gets the tag `@mobile`, as `{ tag: '@mobile' }` or as a word at the end of its
//   title (`test('shows the menu @mobile', ...)`; Playwright reads both).
//   Use it for a test that needs touch input, the phone layout or the mobile branch of a flow,
//   also inside a file that is otherwise generic.
// - A test that depends on the colour scheme gets `@dark`; it then also runs on `mobile`, in dark.
// - A whole file is listed below when every test in it is about phones.
//
// `test/browser-selection.test.ts` checks that both rules and the discovered tests agree.

/** Phone-only files; `desktop` does not run them. */
export const MOBILE_ONLY_SPECS = [
  // Touch gestures and tap targets
  '**/gestures-*.spec.ts',
];

/** Generic files with tests for touch or the phone layout throughout; they run on both. */
export const ALSO_ON_MOBILE_SPECS = [
  '**/staff-menu.spec.ts',
  '**/staff-layout.spec.ts',
  '**/motion.spec.ts',
  '**/form-checks.spec.ts',
  '**/nikolaus-filters.spec.ts',
  '**/nikolaus-dispo-karte.spec.ts',
  '**/leitende-personenvorschlaege.spec.ts',
  '**/aufgaben-assignments.spec.ts',
  '**/rich-text-style.spec.ts',
];

/** A test that runs on `mobile` inside a file that is otherwise generic: touch or phone layout. */
export const MOBILE_TAG = '@mobile';

/**
 * A test whose result can depend on the colour scheme. The helpers of these files pick the dark
 * scheme when the project is `mobile`, so such a test runs once in light on `desktop` and once in
 * dark on `mobile`. Tag a test when it checks a colour, a shadow or a contrast, or takes the
 * screenshot of a state that is worth seeing in both schemes; flows that read no colour need no
 * second run.
 */
export const DARK_TAG = '@dark';

/**
 * A test that loads a source module from the dev server (`import('/src/lib/…')`) to call its
 * functions directly. The built site has no such modules, so these tests run only on the dev
 * server (`E2E_SERVER=built` leaves them out, CI runs them in a job of their own).
 */
export const DEV_SERVER_TAG = '@dev-server';

/** Every file that runs on `mobile` as a whole. */
export const MOBILE_FILE_PATTERNS = [...MOBILE_ONLY_SPECS, ...ALSO_ON_MOBILE_SPECS];

/** Whether a file name (`abrechnung.spec.ts`) matches a pattern of the lists above. */
export function matchesSpecPattern(patterns: string[], file: string): boolean {
  return patterns.some((pattern) => {
    const name = pattern.replace(/^\*\*\//, '');
    const source = name.replace(/[.]/g, '[.]').replace(/\*/g, '[^/]*');
    return new RegExp(`^${source}$`).test(file);
  });
}

/**
 * The `grep` of the `mobile` project. Playwright matches it against the path of the file and the
 * title with its tags, so one expression selects the listed files and the tagged tests.
 */
export const MOBILE_GREP = new RegExp(
  [
    MOBILE_TAG,
    DARK_TAG,
    ...MOBILE_FILE_PATTERNS.map(
      (pattern) =>
        '(?<![\\w-])' +
        pattern
          .replace(/^\*\*\//, '')
          .replace(/[.]/g, '[.]')
          .replace(/\*/g, '[^/ ]*') +
        '(?![\\w-])'
    ),
  ].join('|')
);
