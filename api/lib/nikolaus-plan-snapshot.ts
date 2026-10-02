/** The full plan is one SharePoint CAS value. Invalid data must never look like an empty plan. */
export interface PlanSnapshot<T> {
  schema: 1;
  rows: T[];
}

export function parsePlanSnapshot<T>(
  value: unknown | undefined,
  fallback: T[],
  isRow: (value: unknown) => value is T
): PlanSnapshot<T> {
  if (value === undefined) return { schema: 1, rows: fallback };
  if (
    value === null ||
    typeof value !== 'object' ||
    !('schema' in value) ||
    value.schema !== 1 ||
    !('rows' in value) ||
    !Array.isArray(value.rows) ||
    !value.rows.every(isRow)
  ) {
    throw new Error('Invalid Nikolaus planning snapshot. Restore the state before saving.');
  }
  return { schema: 1, rows: value.rows };
}

export function hasFields(
  value: unknown,
  strings: string[],
  booleans: string[],
  numbers: string[] = []
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    strings.every((key) => typeof row[key] === 'string') &&
    booleans.every((key) => typeof row[key] === 'boolean') &&
    numbers.every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]))
  );
}
