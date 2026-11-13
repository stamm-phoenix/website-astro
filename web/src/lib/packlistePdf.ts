import type { Aktion } from './types/oeffentlich';
import { downloadReportPdf } from './pdfTabelle';
import { packlisteReport } from './packlisteRows';

export async function downloadPackliste(aktion: Aktion): Promise<void> {
  await downloadReportPdf(packlisteReport(aktion));
}
