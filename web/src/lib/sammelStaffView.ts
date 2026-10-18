import { saveFile } from './api';
export { formatOptionalEuro as money } from './format';
import { sammelCsv } from './sammelExport';
import type { SammelBestellung } from './types';
/** Classifies cancelled orders and fully priced, paid and delivered arrivals as completed. */
export function isFinished(order: SammelBestellung): boolean {
  return (
    order.status === 'Storniert' ||
    (order.status === 'Eingetroffen' && order.totalCents !== null && order.paid && order.delivered)
  );
}
/** Downloads an encoded CSV through a temporary object URL and releases it afterwards. */
export function download(name: string, rows: (string | number)[][]): void {
  saveFile(new Blob([sammelCsv(rows)], { type: 'text/csv;charset=utf-8' }), name);
}

/** Page-owned selection: the list is unmounted while the campaign is reloaded. */
export interface SammelOrderFilters {
  search: string;
  showFinished: boolean;
  activeFilters: { submitted: boolean; unpriced: boolean; unpaid: boolean; undelivered: boolean };
}
