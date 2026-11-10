// The `mobile` project (Pixel 7: touch, narrow screen) runs only what is about phones; every
// other test is a generic flow and runs once, on `desktop`. Two ways to put something on `mobile`:
//
// - A single test gets the tag `@mobile`: `test('title', { tag: '@mobile' }, async () => ...)`.
//   Use it for a test that needs touch input, the phone layout or the mobile branch of a flow,
//   also inside a file that is otherwise generic.
// - A whole file is listed below when every test in it is about phones (or needs the dark run).
//
// `test/browser-selection.test.ts` checks that both rules and the discovered tests agree.

/** Phone-only files; `desktop` does not run them. */
export const MOBILE_ONLY_SPECS = [
  // Touch gestures and tap targets
  '**/gestures-*.spec.ts',
  // Concurrent saves, shopping drafts and minutes approval; only written for the phone so far
  // and still waiting for their move to unit tests (#530)
  '**/essensplanung-ki-konflikte.spec.ts',
  '**/essensplanung-einkaeufe-entwuerfe.spec.ts',
  '**/essensplanung-einkaeufe-konflikte.spec.ts',
  '**/protokoll-review.spec.ts',
  '**/essensplanung-zeilen-konflikte.spec.ts',
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

// Files that pick the dark colour scheme when the project is `mobile` (and light otherwise), so
// the `mobile` run is their only run in dark. Not about phones: replace the project check with an
// explicit dark test per flow, then remove the file from this list (#530).
export const DARK_VARIANT_SPECS = [
  '**/aufgaben-actions.spec.ts',
  '**/aufgaben-alignment.spec.ts',
  '**/aufgaben-dashboard.spec.ts',
  '**/aufgaben-planning.spec.ts',
  '**/aufgaben-proposals.spec.ts',
  '**/aufgaben-recovery.spec.ts',
  '**/aufgaben-usability.spec.ts',
  '**/blog-usability.spec.ts',
  '**/kasse-recovery.spec.ts',
  '**/ladezustand.spec.ts',
  '**/nikolaus-recovery.spec.ts',
  '**/nikolaus-stand.spec.ts',
  '**/pflege-formulare.spec.ts',
  '**/pflege-loeschen.spec.ts',
  '**/photo-version.spec.ts',
  '**/protokoll-editor.spec.ts',
  '**/protokoll-termin.spec.ts',
  '**/staff-dates.spec.ts',
  '**/staff-status.spec.ts',
];

/** The tag of a test that runs on `mobile` inside a file that is otherwise generic. */
export const MOBILE_TAG = '@mobile';

/** Every file that runs on `mobile` as a whole. */
export const MOBILE_FILE_PATTERNS = [
  ...MOBILE_ONLY_SPECS,
  ...ALSO_ON_MOBILE_SPECS,
  ...DARK_VARIANT_SPECS,
];

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
