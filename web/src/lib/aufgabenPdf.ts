// PDFs of the Aufgaben: the list as shown, one section per project, and a Vorlage as a checklist
// with an empty box in front of every task to tick off by hand.
import type { SharePointSiteUser } from '../../../api/lib/sharepoint-types';
import { saveFile } from './api';
import {
  BRAND,
  FOOTER_SPACE,
  MARGIN,
  drawPageFooters,
  drawTitle,
  loadPdf,
  pdfFileName,
} from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport, PdfSection } from './pdfTabelle';
import type { Task, TaskProject, TaskTemplate } from './types';
import { taskToday } from './aufgabenView';
import { taskAssigneeNames, taskPeople } from '../../../api/lib/aufgaben-zuordnung';

export interface AufgabenPdfAuswahl {
  tasks: Task[];
  projects: TaskProject[];
  users?: SharePointSiteUser[];
  /** `alle`, `offen` or `erledigt`, as the status tabs. */
  status: string;
  /** `alle`, `''` (without project) or the ID of a project, as the filter. */
  project: string;
  ownOnly: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  alle: 'Offen und erledigt',
  offen: 'Offen',
  erledigt: 'Erledigt',
};
const OHNE_PROJEKT = 'Ohne Projekt';
/** Side of the box to tick off in mm. */
const TICK = 4;

function datum(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : day;
}

function frist(task: Task, today: string): string {
  if (!task.dueDate) return '';
  const overdue = task.state === 'offen' && task.dueDate < today;
  return overdue ? `${datum(task.dueDate)}\nüberfällig` : datum(task.dueDate);
}

function aufgabe(title: string, description: string): string {
  const text = description.trim();
  return text ? `${title}\n${text.length > 240 ? `${text.slice(0, 239)}…` : text}` : title;
}

const anzahl = (n: number): string => (n === 1 ? '1 Aufgabe' : `${n} Aufgaben`);

/** The tasks as shown, with one section per project; pure, so it can be tested. */
export function aufgabenPdfReport(auswahl: AufgabenPdfAuswahl, today = taskToday()): PdfReport {
  const { tasks, projects, users = [] } = auswahl;
  const projekt = projects.find((p) => String(p.id) === auswahl.project);
  const projectName =
    auswahl.project === 'alle'
      ? ''
      : auswahl.project === ''
        ? OHNE_PROJEKT
        : (projekt?.title ?? '');
  const filter = [
    `Status: ${STATUS_LABEL[auswahl.status] ?? auswahl.status}`,
    projectName && `Projekt: ${projectName}`,
    auswahl.ownOnly && 'Nur mir zugewiesen',
  ].filter(Boolean);
  // Projects in the order of the project list, tasks without one last
  const groups = [
    ...projects.map((p) => ({ title: p.title, tasks: tasks.filter((t) => t.projectId === p.id) })),
    {
      title: OHNE_PROJEKT,
      tasks: tasks.filter((t) => !projects.some((p) => p.id === t.projectId)),
    },
  ].filter((group) => group.tasks.length > 0);
  const table = (list: Task[]): Pick<PdfSection, 'columns' | 'rows' | 'widths'> => ({
    columns: ['Aufgabe', 'Zuständig', 'Frist', 'Stand'],
    rows: list.map((task) => [
      aufgabe(task.title, task.description),
      taskAssigneeNames(task, users),
      frist(task, today),
      task.state === 'erledigt' ? 'Erledigt' : 'Offen',
    ]),
    widths: { 1: 45, 2: 24, 3: 20 },
  });
  const sections: PdfSection[] =
    groups.length === 0
      ? [{ lines: ['Keine Aufgaben für diese Auswahl.'] }]
      : projectName || groups.length === 1
        ? [table(groups.flatMap((group) => group.tasks))]
        : groups.map((group) => ({
            heading: `${group.title} · ${anzahl(group.tasks.length)}`,
            ...table(group.tasks),
          }));
  return {
    title: projectName ? `Aufgaben · ${projectName}` : 'Aufgaben',
    subtitle: anzahl(tasks.length),
    notes: [`Filter: ${filter.join(' · ')}`],
    sections,
    fileName: pdfFileName('Aufgaben', projectName, today),
  };
}

function wann(daysBefore: number): string {
  if (daysBefore === 0) return 'Am Tag der Aktion';
  const days = Math.abs(daysBefore);
  const text = days === 1 ? '1 Tag' : `${days} Tage`;
  return daysBefore > 0 ? `${text} vorher` : `${text} danach`;
}

/** A Vorlage as a checklist to tick off by hand; pure, so it can be tested. */
export function vorlageChecklistReport(
  template: TaskTemplate,
  users: SharePointSiteUser[] = []
): PdfReport {
  // Earliest first, as the tasks fall due before the Aktion
  const items = [...template.items].sort((a, b) => b.daysBefore - a.daysBefore);
  return {
    title: template.title,
    subtitle: `Checkliste · ${anzahl(items.length)}`,
    sections: [
      {
        columns: ['', 'Aufgabe', 'Zuständig', 'Wann'],
        rows: items.map((item) => [
          '',
          aufgabe(item.title, item.description),
          taskPeople(item, users)
            .map((person) => person.name)
            .join(', '),
          wann(item.daysBefore),
        ]),
        widths: { 0: 8, 2: 45, 3: 32 },
      },
    ],
    fileName: pdfFileName('Checkliste', template.title),
  };
}

export async function downloadAufgabenPdf(auswahl: AufgabenPdfAuswahl): Promise<void> {
  await downloadReportPdf(aufgabenPdfReport(auswahl));
}

export async function downloadVorlagePdf(
  template: TaskTemplate,
  users: SharePointSiteUser[] = []
): Promise<void> {
  const report = vorlageChecklistReport(template, users);
  const [table] = report.sections;
  const { doc, autoTable } = await loadPdf();
  const y = drawTitle(doc, report.title, [report.subtitle]) + 2;
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE },
    head: [table.columns ?? []],
    body: table.rows ?? [],
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: Object.fromEntries(
      Object.entries(table.widths ?? {}).map(([index, width]) => [index, { cellWidth: width }])
    ),
    // An empty box to tick off in front of every task
    didDrawCell: (cell) => {
      if (cell.section !== 'body' || cell.column.index !== 0) return;
      doc.setDrawColor(...BRAND);
      doc.setLineWidth(0.3);
      doc.rect(cell.cell.x + (cell.cell.width - TICK) / 2, cell.cell.y + 2, TICK, TICK);
    },
  });
  drawPageFooters(doc);
  saveFile(doc.output('blob'), report.fileName);
}
