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

export const ORDER_FILTERS = [
  { key: 'submitted', label: 'Eingereicht' },
  { key: 'unpriced', label: 'Ohne Gesamtbetrag' },
  { key: 'unpaid', label: 'Unbezahlt' },
  { key: 'undelivered', label: 'Nicht ausgeliefert' },
] as const;

/** The orders the list shows with the search and the filters. */
export function filterOrders(
  orders: SammelBestellung[],
  filters: SammelOrderFilters
): SammelBestellung[] {
  const search = filters.search.trim().toLowerCase();
  return orders.filter(
    (order) =>
      (filters.showFinished || !isFinished(order)) &&
      `${order.name} ${order.email}`.toLowerCase().includes(search) &&
      (!filters.activeFilters.submitted || order.status === 'Eingereicht') &&
      (!filters.activeFilters.unpriced || order.totalCents === null) &&
      (!filters.activeFilters.unpaid || !order.paid) &&
      (!filters.activeFilters.undelivered || !order.delivered)
  );
}
