// PDF of the Nikolaus-Dispo of one day: one page per team with its route as a table, for the
// teams to take along in the car.
import { saveFile } from './api';
import { minutesToTime } from './nikolausDispo';
import type { DispoPlan } from './nikolausDispo';
import { tagConflicts } from './nikolausDispoPlan';
import { slotLabel } from './nikolausMaps';
import {
  BRAND,
  FOOTER_SPACE,
  MARGIN,
  PAGE_WIDTH,
  RED,
  drawPageFooters,
  drawTitle,
  hexToRgb,
  loadPdf,
} from './pdfBasis';
import type { StaffNikolausDispoData } from './types';

/** Minutes after the start of the slot from which the PDF mentions the delay, as the page does. */
const NOTABLE_LATE_IN_SLOT = 10;

export interface DispoPdfStop {
  number: number;
  time: string;
  slot: string;
  family: string;
  address: string;
  phone: string;
  children: string;
  /** Warnings first, then the hints for the visit. */
  notes: string[];
  /** Arrives after the end of the booked slot. */
  late: boolean;
}

export interface DispoPdfTeam {
  name: string;
  color: string;
  /** Lines below the team name: numbers, times and the helpers. */
  lines: string[];
  stops: DispoPdfStop[];
}

export interface DispoPdfInput {
  data: StaffNikolausDispoData;
  plan: DispoPlan;
  baseName: string;
  /** Kilometres of a team's route, e.g. `ca. 23 km`. */
  km: (team: string) => string | null;
}

/** What the PDF shows per team, in the order of the routes. */
export function dispoPdfTeams({ data, plan, baseName, km }: DispoPdfInput): DispoPdfTeam[] {
  const stopsById = new Map(data.stops.map((stop) => [stop.id, stop]));
  const visited = new Map(data.rows.filter((row) => row.visited).map((r) => [r.bookingId, r]));
  const colors = new Map(data.teams.map((team) => [team.name, team.color]));
  return plan.routes.map((route) => {
    const children = route.stops.reduce(
      (sum, stop) => sum + (stopsById.get(stop.id)?.childrenCount ?? 0),
      0
    );
    const lines = [
      `${route.stops.length} ${route.stops.length === 1 ? 'Termin' : 'Termine'} · ${children} ${children === 1 ? 'Kind' : 'Kinder'}`,
    ];
    if (route.departure !== null && route.returnTime !== null) {
      const distance = km(route.team);
      lines.push(
        `Abfahrt ${baseName} ${minutesToTime(route.departure)} · zurück ca. ${minutesToTime(route.returnTime)} · Fahrzeit ${Math.round(route.driveMinutes)} Min${distance ? ` · Strecke ${distance}` : ''}`
      );
    }
    const members = data.members[route.team] ?? [];
    if (members.length > 0) {
      lines.push(members.map((member) => `${member.role}: ${member.name}`).join(' · '));
    }
    const stops = route.stops.flatMap((planned, index): DispoPdfStop[] => {
      const booking = stopsById.get(planned.id);
      if (!booking) return [];
      const notes: string[] = [];
      for (const conflict of tagConflicts(data, booking, route.team)) {
        notes.push(
          `Achtung: ${conflict.name} – nicht zu Familien mit „${conflict.tags.join('“, „')}“`
        );
      }
      if (planned.lateAfterSlot > 0) {
        notes.push(`${Math.round(planned.lateAfterSlot)} Min nach Ende des gebuchten Termins`);
      } else if (planned.lateInSlot >= NOTABLE_LATE_IN_SLOT) {
        notes.push(`${Math.round(planned.lateInSlot)} Min nach Beginn des gebuchten Termins`);
      }
      if (!booking.location) {
        notes.push('Adresse nicht auf der Karte gefunden – Fahrzeit nur geschätzt');
      } else if (booking.location.approximate) {
        notes.push('Nur der Ort wurde gefunden – Fahrzeit ungenau');
      }
      if (booking.hidingPlace) notes.push(`Versteck: ${booking.hidingPlace}`);
      if (booking.addressNotes) notes.push(`Adresse: ${booking.addressNotes}`);
      if (booking.notes) notes.push(`Bemerkungen: ${booking.notes}`);
      if (booking.internalTags.length > 0)
        notes.push(`Merkmale: ${booking.internalTags.join(', ')}`);
      const row = visited.get(booking.id);
      if (row) notes.push(`Besucht${row.visitedAt ? ` um ${row.visitedAt} Uhr` : ''}`);
      return [
        {
          number: index + 1,
          time: minutesToTime(planned.start),
          slot: slotLabel(booking.slotKey),
          family: `Familie ${booking.familyName}`,
          address: `${booking.street}, ${booking.postalCode} ${booking.city}`,
          phone: booking.phone,
          children: `${booking.childrenCount} ${booking.childrenCount === 1 ? 'Kind' : 'Kinder'} · ca. ${planned.end - planned.start} Min${booking.withKrampus ? ' · mit Krampus' : ''} · Anfahrt ${Math.round(planned.driveMinutes)} Min`,
          notes,
          late: planned.lateAfterSlot > 0,
        },
      ];
    });
    return { name: route.team, color: colors.get(route.team) ?? '#003056', lines, stops };
  });
}

export interface DispoPdf {
  /** E.g. `Sa., 5. Dez.`. */
  dayLabel: string;
  /** The plan on screen differs from the saved one. */
  draft: boolean;
  /** Driving times estimated from the air-line distance. */
  estimated: boolean;
  teams: DispoPdfTeam[];
  fileName: string;
}

export async function downloadDispoPdf(pdf: DispoPdf): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  const heading = [
    `Nikolaus-Dispo ${pdf.dayLabel}`,
    pdf.draft ? 'Entwurf, nicht gespeichert' : '',
    pdf.estimated ? 'Fahrzeiten nur grob geschätzt (Luftlinie)' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  pdf.teams.forEach((team, index) => {
    if (index > 0) doc.addPage();
    doc.setFillColor(...hexToRgb(team.color));
    doc.rect(0, 0, PAGE_WIDTH, 6, 'F');
    const y = drawTitle(doc, `Team ${team.name}`, [heading, ...team.lines]);
    if (team.stops.length === 0) {
      doc.setFontSize(10);
      doc.text('Keine Termine.', MARGIN, y + 4);
      return;
    }
    autoTable(doc, {
      startY: y + 2,
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
      head: [['Nr.', 'Zeit', 'Familie', 'Besuch', 'Hinweise']],
      body: team.stops.map((stop) => [
        String(stop.number),
        `${stop.time}\nGebucht ${stop.slot}`,
        [stop.family, stop.address, stop.phone ? `Tel. ${stop.phone}` : '']
          .filter(Boolean)
          .join('\n'),
        stop.children,
        stop.notes.join('\n'),
      ]),
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 24 },
        2: { cellWidth: 52 },
        3: { cellWidth: 32 },
      },
      didParseCell: (cell) => {
        if (cell.section !== 'body') return;
        const stop = team.stops[cell.row.index];
        if (cell.column.index === 1) cell.cell.styles.fontStyle = 'bold';
        if (cell.column.index === 1 && stop.late) cell.cell.styles.textColor = RED;
      },
    });
  });
  drawPageFooters(doc);
  saveFile(doc.output('blob'), pdf.fileName);
}
