import { HELP_CONTACTS } from './help-contacts';
import { getSqlErrorNumber } from './db';
import type { SammelArtikel, SammelBestellung, SammelStatus } from './sammelbestellung-model';
import type { SammelPaymentRecord, SammelPaymentEvent } from './sammelbestellung-payment-model';

/** Identifies corrupt persisted data without substituting an apparently empty order. */
export class InvalidSammelDataError extends Error {
  constructor(rowId: string, field: string) {
    super(
      `Eintrag ${rowId}: Das Feld ${field} enthält ungültige Daten. Bitte wende dich an ${HELP_CONTACTS.technik}.`
    );
    this.name = 'InvalidSammelDataError';
  }
}

export interface OrderRow extends SammelBestellung {
  linkSentAt: string;
  paymentRecord: SammelPaymentRecord | null;
  paymentEvents: SammelPaymentEvent[];
}

/** Changes to an order; `payment` replaces the payment record and appends one audit entry. */
export interface SammelOrderChanges {
  name?: string;
  notes?: string;
  items?: SammelArtikel[];
  status?: SammelStatus;
  submitted?: boolean;
  paid?: boolean;
  delivered?: boolean;
  totalCents?: number | null;
  linkSentAt?: string | null;
  payment?: { record: SammelPaymentRecord; event: SammelPaymentEvent };
}

/** SQL Server reports a duplicate key as 2627 (constraint) or 2601 (unique index). */
export function isSammelDuplicate(error: unknown): boolean {
  const number = getSqlErrorNumber(error);
  return number === 2627 || number === 2601;
}

/** Runs the stored value through the same validation as an input, so corrupt rows fail visibly. */
export function validStored<T>(rowId: number | string, field: string, read: () => T): T {
  try {
    return read();
  } catch {
    throw new InvalidSammelDataError(String(rowId), field);
  }
}

/** A timestamp for a `datetime2(3)` column. */
export function time(value: string): string {
  return new Date(value).toISOString();
}

export function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Validated rows omit Rüsthaus, the default supplier; the table names it explicitly. */
export function storedShop(row: { shop?: SammelArtikel['shop'] }): SammelArtikel['shop'] & string {
  return row.shop ?? 'ruesthaus';
}
