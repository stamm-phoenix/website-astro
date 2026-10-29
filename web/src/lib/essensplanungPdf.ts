// PDFs of a Planung, built in the browser instead of printing the page (`docs/essensplanung.md`,
// PDF): the plan for the kitchen, recipe cards, the eaters per meal and the shopping list. The
// rows come from `essensplanungDruck.ts`; this file only lays them out.
import type { jsPDF as JsPdf } from 'jspdf';
import type { autoTable as AutoTableFn, CellHookData } from 'jspdf-autotable';
import { mengeText } from '../../../api/lib/essen-gerichte-model';
import { saveFile } from './api';
import { datumKurz } from './essensplanung';
import {
  anleitungAbsaetze,
  esserKalender,
  kochplan,
  rezeptZeilen,
  teilnehmendeZeilen,
  type DruckZeile,
} from './essensplanungDruck';
import type { EinkaufsGeschaeft } from './essensplanungEinkauf';
import { zahlText } from './essensplanungTeilnehmende';
import {
  BRAND,
  FOOTER_SPACE,
  GREY,
  MARGIN,
  dateiName,
  drawPageFooters,
  drawTitle,
  loadPdf,
} from './pdfBasis';
import type { Gericht, PlanungAnsicht } from './types';

type AutoTable = typeof AutoTableFn;

const TABLE_STYLES = {
  styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.5, overflow: 'linebreak' as const },
  headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' as const },
  alternateRowStyles: { fillColor: [247, 248, 250] as [number, number, number] },
};

/** File name of a PDF of the Planung, e.g. „Einkaufsliste Sommerlager.pdf“. */
export function essenDateiName(was: string, ansicht: Pick<PlanungAnsicht, 'name'>): string {
  return dateiName(was, was, ansicht.name);
}

/** „Sa., 1.8.2027 bis Mo., 3.8.2027“; empty without days. */
function zeitraum(ansicht: PlanungAnsicht): string {
  const erster = ansicht.tage[0];
  const letzter = ansicht.tage.at(-1);
  if (!erster || !letzter) return '';
  return erster === letzter
    ? datumKurz(erster.datum)
    : `${datumKurz(erster.datum)} bis ${datumKurz(letzter.datum)}`;
}

function untertitel(ansicht: PlanungAnsicht): string[] {
  return [[ansicht.name, zeitraum(ansicht)].filter(Boolean).join(' · ')];
}

const endeTabelle = (doc: JsPdf, sonst: number): number =>
  (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? sonst;

/** Starts a new page when less than `platz` mm are left above the footer. */
function platzFuer(doc: JsPdf, y: number, platz: number): number {
  if (y + platz <= doc.internal.pageSize.getHeight() - FOOTER_SPACE) return y;
  doc.addPage();
  return 18;
}

/** A heading in the brand colour; returns where the text below starts. */
function ueberschrift(doc: JsPdf, text: string, y: number, groesse: number): number {
  const top = platzFuer(doc, y, groesse * 0.5 + 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(groesse);
  doc.setTextColor(...BRAND);
  const zeilen = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - 2 * MARGIN);
  doc.text(zeilen, MARGIN, top + groesse * 0.35);
  return top + zeilen.length * groesse * 0.45 + 2;
}

/** Grey text, wrapped; returns where the next line starts. */
function text(doc: JsPdf, inhalt: string, y: number, einzug = 0): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  const zeilen = doc.splitTextToSize(
    inhalt,
    doc.internal.pageSize.getWidth() - 2 * MARGIN - einzug
  );
  let top = y;
  for (const zeile of zeilen) {
    top = platzFuer(doc, top, 5);
    doc.text(zeile, MARGIN + einzug, top + 3.5);
    top += 4.4;
  }
  return top + 1;
}

/** The ingredients of a dish: amount, name, for whom and note. */
function zutatenTabelle(doc: JsPdf, autoTable: AutoTable, zeilen: DruckZeile[], y: number): number {
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
    head: [['Menge', 'Zutat', 'Für wen', 'Hinweis']],
    body: zeilen.map((zeile) => [zeile.menge, zeile.name, zeile.fuer, zeile.hinweis]),
    columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold' }, 1: { cellWidth: 52 } },
  });
  return endeTabelle(doc, y) + 4;
}

/** The plan for the kitchen: per day and meal the planned dishes with their amounts. */
export async function downloadPlanPdf(
  ansicht: PlanungAnsicht,
  namen: Map<number, string>
): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  let y = drawTitle(doc, 'Plan', untertitel(ansicht)) + 2;
  const tage = kochplan(ansicht, namen);
  if (!tage.length) text(doc, 'Die Planung hat noch keine Tage.', y);
  for (const tag of tage) {
    y = ueberschrift(doc, tag.titel, y + 2, 13);
    if (!tag.mahlzeiten.length) y = text(doc, 'Keine Mahlzeiten.', y);
    for (const mahlzeit of tag.mahlzeiten) {
      y = ueberschrift(doc, mahlzeit.titel, y + 1, 11);
      if (mahlzeit.ohne) y = text(doc, mahlzeit.ohne, y);
      if (!mahlzeit.gerichte.length) y = text(doc, 'Noch kein Gericht eingeplant.', y);
      for (const gericht of mahlzeit.gerichte) {
        const zeile = [
          `${gericht.name}: ${zahlText(gericht.portionen)} Portionen`,
          gericht.zustaendig && `zuständig: ${gericht.zustaendig}`,
        ]
          .filter(Boolean)
          .join(' · ');
        y = ueberschrift(doc, zeile, y, 10);
        y = gericht.zeilen.length
          ? zutatenTabelle(doc, autoTable, gericht.zeilen, y)
          : text(doc, 'Das Gericht hat noch keine Zutaten.', y);
      }
    }
  }
  drawPageFooters(doc);
  saveFile(doc.output('blob'), essenDateiName('Plan', ansicht));
}

/** One recipe card per page: ingredients for the people of the dish, instructions, tools. */
export async function downloadRezeptkartenPdf(
  ansicht: PlanungAnsicht,
  gerichte: Gericht[],
  namen: Map<number, string>,
  fileName: string
): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  gerichte.forEach((gericht, index) => {
    if (index > 0) doc.addPage();
    let y =
      drawTitle(doc, gericht.name, [`Für ${gericht.personen} Personen · ${ansicht.name}`]) + 2;
    y = ueberschrift(doc, 'Zutaten', y, 11);
    const zeilen = rezeptZeilen(gericht, ansicht.zutaten, namen);
    y = zeilen.length
      ? zutatenTabelle(doc, autoTable, zeilen, y)
      : text(doc, 'Noch keine Zutaten.', y);
    const absaetze = anleitungAbsaetze(gericht.anleitung);
    if (absaetze.length) {
      y = ueberschrift(doc, 'Anleitung', y + 2, 11);
      for (const absatz of absaetze) {
        if (absatz.art === 'ueberschrift') y = ueberschrift(doc, absatz.text, y, 10);
        else
          y = text(
            doc,
            absatz.art === 'punkt' ? `•  ${absatz.text}` : absatz.text,
            y,
            absatz.art === 'punkt' ? 4 + absatz.ebene * 5 : 0
          );
      }
    }
    if (gericht.werkzeuge.length) {
      y = ueberschrift(doc, 'Werkzeuge', y + 2, 11);
      y = text(doc, gericht.werkzeuge.join(', '), y);
    }
    if (gericht.links.length) {
      y = ueberschrift(doc, 'Links', y + 2, 11);
      for (const link of gericht.links)
        y = text(doc, link.titel ? `${link.titel}: ${link.url}` : link.url, y);
    }
    if (gericht.notiz.trim()) {
      y = ueberschrift(doc, 'Notiz', y + 2, 11);
      text(doc, gericht.notiz, y);
    }
  });
  drawPageFooters(doc);
  saveFile(doc.output('blob'), fileName);
}

/** Days next to each other per page; more go on the next page. */
const TAGE_JE_SEITE = 7;

/** The eaters per meal as a calendar (days across, landscape) and the participants. */
export async function downloadEsserPdf(
  ansicht: PlanungAnsicht,
  namen: Map<number, string>
): Promise<void> {
  const { doc, autoTable } = await loadPdf('landscape');
  let y = drawTitle(doc, 'Esser je Mahlzeit', untertitel(ansicht)) + 2;
  const kalender = esserKalender(ansicht);
  if (!kalender.tage.length) y = text(doc, 'Die Planung hat noch keine Tage.', y);
  for (let start = 0; start < kalender.tage.length; start += TAGE_JE_SEITE) {
    const ende = start + TAGE_JE_SEITE;
    autoTable(doc, {
      ...TABLE_STYLES,
      startY: y,
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
      head: [kalender.tage.slice(start, ende)],
      body: kalender.zeilen.map((zeile) =>
        zeile
          .slice(start, ende)
          .map((zelle) =>
            zelle
              ? [
                  zelle.titel,
                  zelle.ohne,
                  `${zelle.personen} Personen`,
                  `vegetarisch ${zelle.vegetarisch} · vegan ${zelle.vegan}`,
                ]
                  .filter(Boolean)
                  .join('\n')
              : ''
          )
      ),
      alternateRowStyles: {},
      // Each meal starts at the top of its cell, also next to a longer one
      didParseCell: (data: CellHookData) => {
        if (data.section === 'body') data.cell.styles.valign = 'top';
      },
    });
    y = endeTabelle(doc, y) + 6;
  }
  const zeilen = teilnehmendeZeilen(ansicht, namen);
  y = ueberschrift(doc, 'Teilnehmende', y, 12);
  if (!zeilen.length) text(doc, 'Noch keine Teilnehmenden eingetragen.', y);
  else
    autoTable(doc, {
      ...TABLE_STYLES,
      startY: y,
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
      head: [['Gruppe', 'Anzahl', 'Ernährung', 'Unverträglichkeiten', 'Wann', 'Hinweis']],
      body: zeilen,
      columnStyles: { 1: { halign: 'right' } },
    });
  drawPageFooters(doc);
  saveFile(doc.output('blob'), essenDateiName('Esser je Mahlzeit', ansicht));
}

/** Size of the box to tick in front of each thing to buy. */
const KAESTCHEN = 3.2;

/** The shopping list by shop and category, with a box to tick per thing. */
export async function downloadEinkaufslistePdf(
  ansicht: PlanungAnsicht,
  liste: EinkaufsGeschaeft[]
): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  let y = drawTitle(doc, 'Einkaufsliste', untertitel(ansicht)) + 2;
  if (!liste.length) text(doc, 'Noch nichts zu kaufen.', y);
  for (const gruppe of liste) {
    y = ueberschrift(doc, gruppe.geschaeft?.name ?? 'Ohne Geschäft', y + 2, 13);
    const body = gruppe.kategorien.flatMap((kategorie) => [
      [{ content: kategorie.name, colSpan: 3, styles: { fontStyle: 'bold' as const } }],
      ...kategorie.posten.map((posten) => [
        '',
        mengeText(posten.menge, posten.einheit, posten.abtropfgewicht) ?? 'nach Gefühl',
        posten.name,
      ]),
    ]);
    autoTable(doc, {
      ...TABLE_STYLES,
      startY: y,
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
      body,
      alternateRowStyles: {},
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 32, fontStyle: 'bold' } },
      didDrawCell: (data: CellHookData) => {
        // An empty box in front of each thing, not in front of the category rows
        if (data.section !== 'body' || data.column.index !== 0 || data.cell.colSpan > 1) return;
        doc.setDrawColor(...GREY);
        doc.setLineWidth(0.3);
        doc.rect(
          data.cell.x + 1.5,
          data.cell.y + (data.cell.height - KAESTCHEN) / 2,
          KAESTCHEN,
          KAESTCHEN
        );
      },
    });
    y = endeTabelle(doc, y) + 4;
  }
  drawPageFooters(doc);
  saveFile(doc.output('blob'), essenDateiName('Einkaufsliste', ansicht));
}
