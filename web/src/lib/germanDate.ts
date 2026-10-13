export function parseGermanDate(raw: string, required = false): string | null {
  if (!raw.trim()) return required ? null : '';
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${candidate}T12:00:00Z`);
  return Number(year) > 0 &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}
