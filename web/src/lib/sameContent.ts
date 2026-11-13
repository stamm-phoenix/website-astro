/*
 * Whether two JSON values hold the same content, without serializing either of them: it stops at
 * the first difference and allocates nothing. Like `JSON.stringify`, a key whose value is
 * `undefined` counts as missing; unlike it, the order of the keys does not matter.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}

export function sameContent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameContent(item, b[index]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = definedKeys(a);
    return (
      keys.length === definedKeys(b).length && keys.every((key) => sameContent(a[key], b[key]))
    );
  }
  return false;
}
