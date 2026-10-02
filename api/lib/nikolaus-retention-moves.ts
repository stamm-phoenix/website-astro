import type { NikolausStateRecord } from './nikolaus-state';

export interface RetentionMoveJournal {
  sourceId: string;
  operationId: string;
  sourceSlotKey: string;
  targetSlotKey: string;
  copyId?: string;
}

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
const MOVE_MARKER = /^move-(?:source|copy):([a-f\d-]{36}):[a-f\d]{64}$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_.-]{1,180}$/.test(value);
}

function version(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '*';
}

function slot(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}

/** Ownership must remain until source, selected copy and all operation-marked raw rows are gone. */
export function parseRetentionMoveJournal(state: NikolausStateRecord): RetentionMoveJournal {
  const value = state.data;
  if (
    !object(value) ||
    value.schema !== 1 ||
    !identifier(value.sourceId) ||
    state.key !== `booking-move:${value.sourceId}` ||
    typeof value.operationId !== 'string' ||
    !UUID.test(value.operationId) ||
    !version(value.sourceVersion) ||
    typeof value.sourceFingerprint !== 'string' ||
    !/^[a-f\d]{64}$/.test(value.sourceFingerprint) ||
    !slot(value.sourceSlotKey) ||
    !slot(value.targetSlotKey) ||
    (value.copyId !== undefined && !identifier(value.copyId)) ||
    (value.claimedSourceVersion !== undefined && !version(value.claimedSourceVersion)) ||
    !['preparing', 'selected', 'committed', 'aborted'].includes(String(value.phase))
  )
    throw new Error('Invalid retention booking move journal');
  return {
    sourceId: value.sourceId,
    operationId: value.operationId,
    sourceSlotKey: value.sourceSlotKey,
    targetSlotKey: value.targetSlotKey,
    ...(typeof value.copyId === 'string' ? { copyId: value.copyId } : {}),
  };
}

/** A cross-season move belongs to the later slot season, including an orphaned journal. */
export function retentionMoveDate(journal: RetentionMoveJournal): string {
  return (
    journal.sourceSlotKey > journal.targetSlotKey ? journal.sourceSlotKey : journal.targetSlotKey
  ).slice(0, 10);
}

export function isRetentionMoveBooking(
  row: { id: string; fields: Record<string, unknown> },
  journal: RetentionMoveJournal
): boolean {
  if (row.id === journal.sourceId || row.id === journal.copyId) return true;
  const marker =
    typeof row.fields.TokenHash === 'string' ? row.fields.TokenHash.match(MOVE_MARKER) : undefined;
  return marker?.[1] === journal.operationId;
}
