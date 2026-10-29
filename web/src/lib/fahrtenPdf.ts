// PDF of the Fahrten plan: per direction an overview, then one section per car with the driver
// and the passengers, and who has no seat.
import { FAHRT_LABEL, freiePlaetze } from './fahrtenPlan';
import type { FahrtPerson, FahrtPlan } from './fahrtenPlan';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport, PdfSection } from './pdfTabelle';
import { pdfText } from './pdfZeichen';

export interface FahrtenPdf {
  title: string;
  /** Dates of the Aktion, e.g. „12.06.2026 – 14.06.2026“. */
  range: string;
  plans: FahrtPlan[];
}

const COLUMNS = ['Name', 'Gruppe', 'Telefon'];
const WIDTHS = { 0: 60, 1: 45 };

function personRow(person: FahrtPerson): string[] {
  return [pdfText(person.name), pdfText(person.gruppe), pdfText(person.telefon ?? '')];
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function planSections(plan: FahrtPlan, newPage: boolean): PdfSection[] {
  const fahrt = FAHRT_LABEL[plan.fahrt];
  const mitfahrende = plan.autos.reduce((n, auto) => n + auto.mitfahrende.length, 0);
  const sections: PdfSection[] = [
    {
      heading: fahrt,
      lines: [
        plan.autos.length === 0
          ? 'Niemand hat Plätze angeboten.'
          : [
              count(plan.autos.length, 'Auto', 'Autos'),
              `${mitfahrende} Mitfahrende`,
              `${plan.ohnePlatz.length} ohne Platz`,
            ].join(' · '),
      ],
      newPage,
    },
  ];
  plan.autos.forEach((auto, index) => {
    const belegt = auto.mitfahrende.length + 1;
    sections.push({
      heading: `${fahrt} – Auto ${index + 1}: ${pdfText(auto.fahrer.name)}`,
      lines: [
        [
          auto.fahrer.telefon ? `Telefon: ${pdfText(auto.fahrer.telefon)}` : '',
          `${belegt} von ${auto.plaetze} ${auto.plaetze === 1 ? 'Platz' : 'Plätzen'} belegt`,
          freiePlaetze(auto) > 0 ? `${freiePlaetze(auto)} frei` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        ...(auto.mitfahrende.length === 0 ? ['Fährt allein.'] : []),
      ],
      ...(auto.mitfahrende.length > 0 && {
        columns: COLUMNS,
        rows: auto.mitfahrende.map(personRow),
        widths: WIDTHS,
      }),
    });
  });
  if (plan.ohnePlatz.length > 0) {
    sections.push({
      heading: `${fahrt} – Ohne Platz (${plan.ohnePlatz.length})`,
      columns: COLUMNS,
      rows: plan.ohnePlatz.map(personRow),
      widths: WIDTHS,
    });
  }
  if (plan.entfernt.length > 0) {
    sections.push({
      heading: `${fahrt} – Nicht eingeplant (${plan.entfernt.length})`,
      columns: COLUMNS,
      rows: plan.entfernt.map(personRow),
      widths: WIDTHS,
    });
  }
  return sections;
}

/** Each direction starts on its own page. */
export function fahrtenPdfReport(fahrten: FahrtenPdf): PdfReport {
  return {
    title: 'Fahrten',
    subtitle: pdfText(`${fahrten.title} · ${fahrten.range}`),
    sections: fahrten.plans.flatMap((plan, index) => planSections(plan, index > 0)),
    fileName: pdfFileName('Fahrten', fahrten.title),
  };
}

export async function downloadFahrtenPdf(fahrten: FahrtenPdf): Promise<void> {
  await downloadReportPdf(fahrtenPdfReport(fahrten));
}
