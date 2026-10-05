import type { TestContext } from 'node:test';

/** Overrides fields of a `CONFIG` section for one test and restores them afterwards. */
export function overrideConfig<T extends object>(
  t: TestContext,
  section: T,
  values: Partial<T>
): void {
  const previous = new Map(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(section, key)])
  );
  Object.assign(section, values);
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(section, key, descriptor);
      else delete (section as Record<string, unknown>)[key];
    }
  });
}
