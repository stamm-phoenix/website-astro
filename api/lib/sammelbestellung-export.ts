import type { SammelArtikel, SammelBestellung } from './sammelbestellung-model';

export function aggregateSammelItems(orders: SammelBestellung[]): SammelArtikel[] {
  const result = new Map<string, SammelArtikel>();
  for (const order of orders.filter((row) => row.submitted && row.status !== 'Storniert')) {
    for (const item of order.items) {
      const key = JSON.stringify([item.reference.trim(), item.name.trim(), item.variant.trim()]);
      const existing = result.get(key);
      if (existing) existing.quantity += item.quantity;
      else result.set(key, { ...item });
    }
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
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
