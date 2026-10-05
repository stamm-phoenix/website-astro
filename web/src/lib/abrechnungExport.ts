// Data for the PDF exports that combine the Abrechnung with other sources.
import { LEIHGEBUEHREN_BESCHLUSS } from './abrechnungRechnung';
import type { Leihgebuehren } from './abrechnungRechnung';
import type { PdfLeihgebuehren } from './abrechnungPdf';
import { formatDate } from './campflowFields';
import type { Abrechnung } from './types';
import { fetchVorstand, vorstandStore } from './vorstandStore.svelte';

/** The letter of the Materialleihgebühren, with the Stammesvorsitzende from the Leitende list. */
export async function leihgebuehrenPdfData(
  abrechnung: Abrechnung,
  result: Leihgebuehren
): Promise<PdfLeihgebuehren> {
  if (!vorstandStore.data) await fetchVorstand();
  return {
    aktion: abrechnung.event.title,
    von: formatDate(abrechnung.event.start_date) || '–',
    bis: formatDate(abrechnung.event.end_date ?? abrechnung.event.start_date) || '–',
    positions: result.positions,
    totalCent: result.totalCent,
    vorstaende: vorstandStore.data ?? [],
    beschluss: LEIHGEBUEHREN_BESCHLUSS,
  };
}
