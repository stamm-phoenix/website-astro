import type { StaffGate } from './handler';
import { withProtokollGate } from './protokoll-cutover';

/**
 * The gate of the area „protokolle“ (`staffHandler`): its requests run while they share the
 * lock of the cut-over to SQL. Calls `withProtokollGate` through its module, so tests can
 * replace it.
 */
export const protokollGate: StaffGate = { run: (work) => withProtokollGate(work) };
