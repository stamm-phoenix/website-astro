// PDF of the route of one team on one day („Ansicht für unterwegs“), in the layout of the
// Dispo-PDF so both sheets look the same.
import { saveFile } from './api';
import { drawDispoTeamPage } from './nikolausDispoPdf';
import type { DispoPdfStop, DispoPdfTeam } from './nikolausDispoPdf';
import { slotLabel } from './nikolausMaps';
import { drawPageFooters, loadPdf } from './pdfBasis';
import type { StaffNikolausFahrtData, StaffNikolausFahrtStop } from './types';

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function fahrtPdfStop(stop: StaffNikolausFahrtStop, index: number): DispoPdfStop {
  const notes: string[] = [];
  if (stop.visited) notes.push(`Besucht${stop.visitedAt ? ` um ${stop.visitedAt} Uhr` : ''}`);
  if (stop.moved) notes.push(`Seit der Dispo auf ${stop.slotKey.split('T')[1]} Uhr verlegt`);
  if (!stop.location) notes.push('Adresse nicht auf der Karte gefunden – bitte genau prüfen');
  else if (stop.location.approximate) notes.push('Nur der Ort wurde gefunden – bitte genau prüfen');
  if (stop.hidingPlace) notes.push(`Versteck: ${stop.hidingPlace}`);
  if (stop.addressNotes) notes.push(`Zur Adresse: ${stop.addressNotes}`);
  if (stop.notes) notes.push(`Bemerkungen: ${stop.notes}`);
  return {
    number: index + 1,
    time: `ca. ${stop.plannedArrival}`,
    slot: slotLabel(stop.slotKey),
    family: `Familie ${stop.familyName}`,
    address: `${stop.street}, ${stop.postalCode} ${stop.city}`,
    phone: stop.phone,
    children: `${count(stop.childrenCount, 'Kind', 'Kinder')}${stop.withKrampus ? ' · mit Krampus' : ''}`,
    notes,
    late: false,
    done: stop.visited,
  };
}

/** The team's route as the page shows it, with the visits ticked off so far. */
export function fahrtPdfTeam(
  data: StaffNikolausFahrtData,
  team: string,
  stops: StaffNikolausFahrtStop[]
): DispoPdfTeam {
  const children = stops.reduce((sum, stop) => sum + stop.childrenCount, 0);
  const visited = stops.filter((stop) => stop.visited).length;
  const lines = [
    `${count(stops.length, 'Termin', 'Termine')} · ${count(children, 'Kind', 'Kinder')}${visited > 0 ? ` · ${visited} von ${stops.length} besucht` : ''}`,
  ];
  const members = data.members[team] ?? [];
  if (members.length > 0) {
    lines.push(members.map((member) => `${member.role}: ${member.name}`).join(' · '));
  }
  if (data.droppedCount > 0 || data.unplannedCount > 0) {
    lines.push('Die Dispo ist nicht mehr ganz aktuell. Bitte gebt der Dispo Bescheid.');
  }
  return {
    name: team,
    color: data.teams.find((t) => t.name === team)?.color ?? '#003056',
    lines,
    stops: stops.map(fahrtPdfStop),
  };
}

export async function downloadFahrtPdf(
  team: DispoPdfTeam,
  heading: string,
  fileName: string
): Promise<void> {
  const { doc, autoTable } = await loadPdf();
  drawDispoTeamPage(doc, autoTable, team, heading);
  drawPageFooters(doc);
  saveFile(doc.output('blob'), fileName);
}
