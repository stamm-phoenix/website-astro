// PDF of the Nikolaus-Einteilung: per day a table with the posts of each team and the kitchen
// below. Shows the same as the picture (`nikolausEinteilungBild.ts`).
import { saveFile } from './api';
import type { EinteilungBild } from './nikolausEinteilungBild';
import {
  BRAND,
  FOOTER_SPACE,
  GREY,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  RED,
  drawPageFooters,
  drawTitle,
  hexToRgb,
  loadPdf,
} from './pdfBasis';

/** Room a day needs below its heading before it moves to the next page. */
const MIN_DAY_SPACE = 70;
const OPEN = 'offen';
const TEXT: [number, number, number] = [30, 30, 30];

export async function downloadEinteilungPdf(pdf: EinteilungBild, fileName: string): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  let y = drawTitle(doc, pdf.title, [pdf.subtitle]) + 2;
  for (const day of pdf.days) {
    if (y > PAGE_HEIGHT - MIN_DAY_SPACE) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...BRAND);
    doc.text(day.label, MARGIN, y + 4);
    y += 7;
    if (day.teams.length > 0) {
      const roles = day.teams[0].posts.map((post) => post.role);
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
        head: [['', ...day.teams.map((team) => `Team ${team.name}`)]],
        body: roles.map((role, index) => [
          role,
          ...day.teams.map((team) => team.posts[index]?.name ?? OPEN),
        ]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [247, 248, 250] },
        columnStyles: { 0: { cellWidth: 26, fontStyle: 'bold', textColor: BRAND } },
        didParseCell: (cell) => {
          const team = day.teams[cell.column.index - 1];
          if (!team) return;
          if (cell.section === 'head') cell.cell.styles.fillColor = hexToRgb(team.color);
          if (cell.section === 'body' && team.posts[cell.row.index]?.name === null) {
            cell.cell.styles.textColor = RED;
            cell.cell.styles.fontStyle = 'italic';
          }
        },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND);
    doc.text('Küche:', MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...(day.kitchen.length > 0 ? TEXT : GREY));
    const kitchen = doc.splitTextToSize(
      day.kitchen.length > 0 ? day.kitchen.join(', ') : 'Niemand',
      PAGE_WIDTH - 2 * MARGIN - 14
    );
    doc.text(kitchen, MARGIN + 14, y);
    y += 4.5 * kitchen.length + 8;
  }
  drawPageFooters(doc);
  saveFile(doc.output('blob'), fileName);
}
