import type { RescueField } from './geretteteEingaben';

/**
 * Keeps a helper's list of wishes (e.g. „Bevorzugt zu Familien mit“) across a new login in the
 * iPhone app, including an emptied list. `set` returns false if the form is gone.
 */
export function rescueTags(
  label: string,
  get: () => string[] | undefined,
  set: (tags: string[]) => boolean
): RescueField {
  return {
    key: `${label}#custom`,
    get: () => JSON.stringify(get() ?? []),
    describe: (value) => (JSON.parse(value) as string[]).join(', '),
    set(value) {
      try {
        const tags: unknown = JSON.parse(value);
        if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) return false;
        return set(tags);
      } catch {
        return false;
      }
    },
  };
}
