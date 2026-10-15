import { formatEuro } from './format';
import { sammelCsv } from './sammelExport';
import type { SammelBestellung } from './types';
/** Formats stored cent amounts as euros, preserving an unset staff price. */
export const money = (cents: number | null): string =>
  cents === null ? 'Noch offen' : formatEuro(cents);

/** Classifies cancelled orders and fully priced, paid and delivered arrivals as completed. */
export function isFinished(order: SammelBestellung): boolean {
  return (
    order.status === 'Storniert' ||
    (order.status === 'Eingetroffen' && order.totalCents !== null && order.paid && order.delivered)
  );
}
/** Downloads an encoded CSV through a temporary object URL and releases it afterwards. */
export function download(name: string, rows: (string | number)[][]): void {
  const url = URL.createObjectURL(new Blob([sammelCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Page-owned selection: the list is unmounted while the campaign is reloaded. */
export interface SammelOrderFilters {
  search: string;
  showFinished: boolean;
  activeFilters: { submitted: boolean; unpriced: boolean; unpaid: boolean; undelivered: boolean };
}
