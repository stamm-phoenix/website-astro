// The `mobile` project (Pixel 7: touch, narrow screen) runs only specs that are about phones.
// Everything else is a generic flow and runs once, on `desktop`. Add a spec to one of the lists
// below only when it needs touch input or the phone layout; the unit test
// `test/browser-selection.test.ts` keeps the lists and the discovered tests in sync.

// Phone-only specs; `desktop` does not run them.
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

// Generic specs with a touch or phone branch; they run on `desktop` and on `mobile`.
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
  // Mostly generic; each has tests for the narrow screen or touch input next to them
  '**/abrechnung.spec.ts',
  '**/nikolaus-buchung.spec.ts',
  '**/essensplanung-zeilen.spec.ts',
];
