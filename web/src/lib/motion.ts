/** Read at the moment of use, including changes to the system preference during a visit. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window === 'undefined' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'instant'
    : 'smooth';
}
