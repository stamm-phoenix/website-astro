import type { ColumnType } from 'kysely';

/** Set by the database (rowversion, computed columns); never written by the code. */
export type ReadOnly<T> = ColumnType<T, never, never>;

/**
 * A `date` column: read as a Date at UTC midnight, written and compared as `YYYY-MM-DD`.
 * (The driver would send a Date as legacy `datetime`.)
 */
export type SqlDate = ColumnType<Date | string, string, string>;

/** A `datetime2(3)` column, written as an ISO string so the milliseconds stay exact. */
export type SqlTime = ColumnType<Date, string, string>;
export type SqlTimeOrNull = ColumnType<Date | null, string | null, string | null>;
