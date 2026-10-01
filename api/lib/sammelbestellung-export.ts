import { getSammelShop } from './sammelbestellung-shops';
import type { SammelArtikel, SammelBestellung } from './sammelbestellung-model';

/** Combines submitted, noncancelled items by reference and variant while summing quantities. */
export function aggregateSammelItems(orders: SammelBestellung[]): SammelArtikel[] {
  const result = new Map<string, SammelArtikel>();
  for (const order of orders.filter((row) => row.submitted && row.status !== 'Storniert')) {
    for (const item of order.items) {
      // The product reference identifies the article; member-entered names may differ.
      const key = JSON.stringify([
        getSammelShop(item.reference, item.shop),
        item.reference.trim(),
        item.variant.trim(),
      ]);
      const existing = result.get(key);
      if (existing) existing.quantity += item.quantity;
      else result.set(key, { ...item });
    }
  }
  return [...result.values()].sort(
    (a, b) =>
      getSammelShop(a.reference, a.shop).localeCompare(getSammelShop(b.reference, b.shop)) ||
      a.name.localeCompare(b.name, 'de')
  );
}

/** Quote every cell and neutralize spreadsheet formulas supplied in free-entry fields. */
export function sammelCsv(rows: (string | number)[][]): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((cell) => {
            let value = String(cell);
            if (/^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value)) value = `'${value}`;
            return `"${value.replace(/"/g, '""')}"`;
          })
          .join(';')
      )
      .join('\r\n')
  );
}

export interface SammelReceipt {
  subtotalCents: number;
  missingPositions: number;
  totalCents: number | null;
}

/** Sums integer-cent line amounts and withholds the total when any item price is missing. */
export function sammelReceipt(
  items: SammelArtikel[],
  prices: Record<string, number | null>
): SammelReceipt {
  let subtotalCents = 0;
  let missingPositions = 0;
  for (const item of items) {
    const price = prices[item.reference.trim()];
    if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0) missingPositions++;
    else subtotalCents += price * item.quantity;
  }
  return { subtotalCents, missingPositions, totalCents: missingPositions ? null : subtotalCents };
}
