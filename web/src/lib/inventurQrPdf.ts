import { inventurLink } from './inventurQr';
import { loadPdf } from './pdfBasis';
import { pdfText } from './pdfText';
import { qrMatrix } from './qrCode';
import type { InventarArtikel } from './inventur';

/** Six 60 × 80 mm labels per A4 page; vector modules keep the code sharp when printed. */
export async function inventurSchilderPdf(
  artikel: InventarArtikel[],
  origin: string
): Promise<void> {
  if (!artikel.length) return;
  const { doc } = await loadPdf();
  for (const [index, item] of artikel.entries()) {
    if (index > 0 && index % 6 === 0) doc.addPage();
    const x = 40 + (index % 2) * 75;
    const y = 18 + Math.floor((index % 6) / 2) * 88;
    doc.setDrawColor(180);
    doc.rect(x, y, 60, 80);
    const matrix = qrMatrix(inventurLink(origin, item.id), false);
    const cell = 40 / (matrix.size + 8);
    doc.setFillColor(255, 255, 255);
    doc.rect(x + 10, y + 8, 40, 40, 'F');
    doc.setFillColor(0, 0, 0);
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        if (matrix.isDark(row, col))
          doc.rect(x + 10 + (col + 4) * cell, y + 8 + (row + 4) * cell, cell, cell, 'F');
      }
    }
    doc.setTextColor(0);
    doc.setFontSize(11);
    const lines: string[] = doc.splitTextToSize(pdfText(item.bezeichnung), 52);
    doc.text(lines.slice(0, 3), x + 4, y + 55);
    doc.setFontSize(9);
    doc.text(`Inventar ${item.id}`, x + 4, y + 74);
  }
  doc.save(artikel.length === 1 ? `Inventarschild ${artikel[0].id}.pdf` : 'Inventarschilder.pdf');
}
