import type { Aktion } from './types';
import type { PdfReport } from './pdfTabelle';

export function packlisteReport(aktion: Aktion): PdfReport {
  return {
    title: 'Packliste',
    subtitle: aktion.title,
    notes: [aktion.start === aktion.end ? aktion.start : `${aktion.start} – ${aktion.end}`],
    sections: [
      {
        columns: ['Erledigt', 'Gegenstand'],
        rows: (aktion.packingList ?? []).map((item) => ['', item]),
        widths: { 0: 18 },
        handwriting: { rowHeight: 8 },
      },
    ],
    fileName: `Packliste ${aktion.title.replace(/[<>:"/\\|?*]/g, '-')}.pdf`,
  };
}
