// PDF of the member list as shown: the tab and the search, with birthday and contacts, e.g. for
// the group folder or a camp.
import { ageAt, formatDate, formatName, formatValue } from './campflowFields';
import type { CampflowColumn, CampflowPerson } from './types';
import { mitgliedStatus, personGroups, type MitgliederAnsicht } from './mitglieder';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf, type PdfReport } from './pdfTabelle';
import { pdfText } from './pdfText';

/** Fields of parents and emergency contacts, named freely in CampFlow. */
const PARENT_FIELD = /eltern|erziehungsberechtig|notfall/i;

export interface MitgliederPdfInput {
  /** The members of the tab and the search, in the order of the page. */
  persons: CampflowPerson[];
  columns: CampflowColumn[];
  ansicht: MitgliederAnsicht;
  search: string;
  /** `YYYY-MM-DD` in Berlin, for the age and the status. */
  today: string;
}

function lines(values: string[]): string {
  return values.map(pdfText).filter(Boolean).join('\n');
}

function titleOf(ansicht: MitgliederAnsicht): string {
  if (ansicht === 'alle') return 'Mitglieder';
  if (ansicht === 'ohne-gruppe') return 'Mitglieder ohne Gruppe';
  if (ansicht === 'ausgetreten') return 'Ausgetretene Mitglieder';
  return `Mitglieder ${pdfText(ansicht.slice('gruppe:'.length))}`;
}

function nameCell(person: CampflowPerson, today: string): string {
  const status = mitgliedStatus(person, today);
  const leave = formatDate(typeof person.leave_date === 'string' ? person.leave_date : '');
  const join = formatDate(typeof person.join_date === 'string' ? person.join_date : '');
  const note =
    status === 'ausgetreten'
      ? leave
        ? `Ausgetreten am ${leave}`
        : 'Ausgetreten'
      : status === 'kuenftig'
        ? `Tritt am ${join} ein`
        : '';
  return lines([formatName(person), note]);
}

function birthdayCell(person: CampflowPerson, today: string): string {
  const age = ageAt(person, today);
  const birthday = typeof person.birthdate === 'string' ? formatDate(person.birthdate) : '';
  if (!birthday) return age === null ? '' : `${age} Jahre`;
  return age === null ? birthday : `${birthday} (${age})`;
}

function phones(person: CampflowPerson): string[] {
  const numbers = Array.isArray(person.phone_numbers) ? person.phone_numbers : [];
  return numbers.map((phone) => formatValue(phone));
}

function emails(person: CampflowPerson): string[] {
  const cc = Array.isArray(person.cc_emails) ? person.cc_emails : [];
  return [person.primary_email, ...cc].filter((mail): mail is string => typeof mail === 'string');
}

/** A custom field, keyed by its column id or by `custom_{external_id}`. */
function columnText(person: CampflowPerson, column: CampflowColumn): string {
  const value =
    person[column.id] ?? (column.external_id ? person[`custom_${column.external_id}`] : undefined);
  return formatValue(value, column.id);
}

/** The table of the members; the groups only where the tab does not already say them. */
export function mitgliederReport(input: MitgliederPdfInput): PdfReport {
  const { persons, columns, ansicht, search, today } = input;
  const withParents = columns
    .filter((column) => PARENT_FIELD.test(column.name))
    .filter((column) => persons.some((person) => columnText(person, column) !== ''));
  const showGroups = ansicht !== 'ohne-gruppe';
  const header = [
    'Name',
    'Geburtstag (Alter)',
    ...(showGroups ? ['Gruppen'] : []),
    'Telefon',
    'E-Mail',
    ...(withParents.length > 0 ? ['Eltern'] : []),
    'Adresse',
  ];
  const rows = persons.map((person) => [
    nameCell(person, today),
    birthdayCell(person, today),
    ...(showGroups ? [lines(personGroups(person))] : []),
    lines(phones(person)),
    lines(emails(person)),
    ...(withParents.length > 0
      ? [lines(withParents.map((column) => columnText(person, column)))]
      : []),
    pdfText(formatValue(person.address, 'address')),
  ]);
  const term = search.trim();
  const count = `${persons.length} ${persons.length === 1 ? 'Mitglied' : 'Mitglieder'}`;
  return {
    title: titleOf(ansicht),
    subtitle: `Stand ${formatDate(today)} · ${count}`,
    notes: term ? [pdfText(`Suche: „${term}“`)] : undefined,
    landscape: true,
    sections: [
      {
        columns: header,
        rows,
        widths: showGroups ? { 0: 42, 1: 30, 2: 34 } : { 0: 42, 1: 30 },
      },
    ],
    fileName: pdfFileName(titleOf(ansicht), today),
  };
}

export async function downloadMitgliederPdf(input: MitgliederPdfInput): Promise<void> {
  await downloadReportPdf(mitgliederReport(input));
}
