/** Stable links and printable label data, independent of the browser and PDF library. */
export function inventurLink(origin: string, id: number): string {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Ungültige Inventarnummer.');
  const url = new URL('/leitendenbereich/inventur', origin);
  url.searchParams.set('artikel', String(id));
  return url.href;
}

export function inventurArtikelId(search: string): number | null {
  const value = new URLSearchParams(search).get('artikel');
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
