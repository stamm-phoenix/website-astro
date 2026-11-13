import type { StatusTone } from './status';
import type { StaffProblemMeldung } from './problemMelden';

/** How the status of a Problemmeldung is shown in the lists and the dialog. */
export const PROBLEM_STATUS: Record<
  StaffProblemMeldung['status'],
  { label: string; tone: StatusTone }
> = {
  neu: { label: 'Neu', tone: 'warning' },
  in_pruefung: { label: 'In Prüfung', tone: 'neutral' },
  verworfen: { label: 'Verworfen', tone: 'neutral' },
  uebermittelt: { label: 'An GitHub gesendet', tone: 'success' },
};

/** The automatic assessment as a short label, or `null` while there is none. */
export function assessment(item: StaffProblemMeldung): { label: string; tone: StatusTone } | null {
  const { status, verdict } = item.ai;
  if (status === 'fertig' && verdict === 'plausibel')
    return { label: 'Einschätzung: plausibel', tone: 'success' };
  if (status === 'fertig' && verdict === 'unklar')
    return { label: 'Einschätzung: unklar', tone: 'warning' };
  if (status === 'fertig' && verdict === 'spam')
    return { label: 'Einschätzung: Spam', tone: 'danger' };
  if (status === 'fehler') return { label: 'Einschätzung fehlgeschlagen', tone: 'danger' };
  if (status === 'nicht_eingerichtet')
    return { label: 'Keine Einschätzung eingerichtet', tone: 'neutral' };
  return { label: 'Einschätzung ausstehend', tone: 'neutral' };
}

/** What went wrong with the assessment, in words; the stored text is a technical one. */
export function assessmentFailure(error: string): string {
  if (/timed out/i.test(error)) return 'Die Antwort kam nicht rechtzeitig';
  if (/unreachable/i.test(error)) return 'Der Dienst war nicht erreichbar';
  if (/Tageslimit/i.test(error)) return 'Das Tageslimit für Einschätzungen ist erreicht';
  const status = /\b(\d{3})\b/.exec(error)?.[1];
  if (status === '429') return 'Gerade sind zu viele Anfragen unterwegs';
  if (status) return `Der Dienst antwortete mit Fehler ${status}`;
  return 'Die Antwort war nicht brauchbar';
}
