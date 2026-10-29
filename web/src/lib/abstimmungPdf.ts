// PDF of the result of an Abstimmung, e.g. to attach to a Protokoll: the question, the votes per
// option, who chose what and who did not answer. It shows only what everyone who votes may see,
// so an anonymous or secret Abstimmung stays so even when its organizer creates the PDF.
import { formatDateTime } from './format';
import { pdfFileName } from './pdfBasis';
import { downloadReportPdf } from './pdfTabelle';
import type { PdfReport, PdfSection } from './pdfTabelle';
import { antwortenText, spitzenreiter } from './abstimmungZahlen';
import type { AbstimmungDetail, AbstimmungEinsicht } from '../../../api/lib/abstimmung-model';
import { MIN_ANTWORTEN_FUER_ZAHLEN, abstimmungEinsicht } from '../../../api/lib/abstimmung-model';

/** More options than this list each person's choice in words instead of a column per option. */
const MAX_MATRIX_OPTIONEN = 8;
/** More options than this turn the page to landscape. */
const MAX_HOCHKANT_OPTIONEN = 4;

const SICHTBARKEIT_NOTIZ: Record<AbstimmungEinsicht, string | null> = {
  alles: null,
  namen: 'Anonyme Abstimmung: Was jemand gewählt hat, steht nicht in diesem PDF.',
  anzahl: 'Geheime Abstimmung: Wer abgestimmt hat und was, steht nicht in diesem PDF.',
};

/** What everyone who votes may see; the organizer sees more on the page than the PDF shows. */
function pdfEinsicht(abstimmung: AbstimmungDetail): AbstimmungEinsicht {
  const rang: AbstimmungEinsicht[] = ['anzahl', 'namen', 'alles'];
  const fuerAlle = abstimmungEinsicht(abstimmung.sichtbarkeit, false);
  return rang[Math.min(rang.indexOf(fuerAlle), rang.indexOf(abstimmung.einsicht))];
}

function ergebnisSection(abstimmung: AbstimmungDetail, einsicht: AbstimmungEinsicht): PdfSection {
  const anzahl = abstimmung.anzahlAntworten;
  const verborgen =
    abstimmung.zahlenVerborgen || (einsicht !== 'alles' && anzahl < MIN_ANTWORTEN_FUER_ZAHLEN);
  const heading = `Ergebnis · ${antwortenText(anzahl)}`;
  if (anzahl === 0) return { heading, lines: ['Niemand hat abgestimmt.'] };
  if (verborgen) {
    return {
      heading,
      lines: [`Die Stimmen je Option zählen erst ab ${MIN_ANTWORTEN_FUER_ZAHLEN} Antworten.`],
    };
  }
  const vorne = spitzenreiter(abstimmung);
  const vielleicht = abstimmung.vielleichtErlaubt;
  return {
    heading,
    columns: ['Option', 'Ja', ...(vielleicht ? ['Vielleicht'] : []), ''],
    rows: abstimmung.optionen.map((option) => [
      option.text,
      String(option.stimmen),
      ...(vielleicht ? [String(option.vielleicht)] : []),
      vorne.has(option.id) ? 'Meiste Stimmen' : '',
    ]),
    alignRight: vielleicht ? [1, 2] : [1],
    widths: vielleicht ? { 1: 14, 2: 20, 3: 28 } : { 1: 14, 2: 28 },
  };
}

function wahlSection(abstimmung: AbstimmungDetail): PdfSection {
  const { optionen, antworten, vielleichtErlaubt } = abstimmung;
  const heading = 'Wer was gewählt hat';
  if (optionen.length <= MAX_MATRIX_OPTIONEN) {
    const foot = [['Ja', ...optionen.map((option) => String(option.stimmen))]];
    if (vielleichtErlaubt) {
      foot.push(['Vielleicht', ...optionen.map((option) => String(option.vielleicht))]);
    }
    return {
      heading,
      columns: ['Name', ...optionen.map((option) => option.text)],
      rows: antworten.map((antwort) => [
        antwort.name,
        ...optionen.map((option) => {
          if (antwort.gewaehlt.includes(option.id)) return 'Ja';
          if (antwort.vielleicht.includes(option.id)) return 'Vielleicht';
          return '–';
        }),
      ]),
      foot,
      widths: { 0: 40 },
    };
  }
  const texte = (ids: number[]): string =>
    optionen
      .filter((option) => ids.includes(option.id))
      .map((option) => option.text)
      .join('\n');
  return {
    heading,
    columns: ['Name', 'Ja', ...(vielleichtErlaubt ? ['Vielleicht'] : [])],
    rows: antworten.map((antwort) => [
      antwort.name,
      antwort.gewaehlt.length + antwort.vielleicht.length === 0
        ? 'Keine Option passt'
        : texte(antwort.gewaehlt),
      ...(vielleichtErlaubt ? [texte(antwort.vielleicht)] : []),
    ]),
    widths: { 0: 40 },
  };
}

/** The result as the sections of a report; pure, so it can be tested without a browser. */
export function abstimmungPdfReport(abstimmung: AbstimmungDetail): PdfReport {
  const einsicht = pdfEinsicht(abstimmung);
  const sections: PdfSection[] = [ergebnisSection(abstimmung, einsicht)];
  const anzahl = abstimmung.anzahlAntworten;
  if (einsicht === 'alles' && anzahl > 0) sections.push(wahlSection(abstimmung));
  if (einsicht === 'namen' && anzahl > 0) {
    sections.push({
      heading: 'Abgestimmt',
      lines: [abstimmung.antworten.map((antwort) => antwort.name).join(', ')],
    });
  }
  const offen = (abstimmung.teilnahmen ?? []).filter((t) => !t.geantwortet);
  // The invitations are only the organizer's to see; an anonymous result is meant to be shared
  if (einsicht === 'alles' && offen.length > 0) {
    sections.push({
      heading: `Nicht abgestimmt · ${offen.length}`,
      lines: [offen.map((t) => t.name || t.email).join(', ')],
    });
  }
  const notes = [abstimmung.beschreibung.trim(), SICHTBARKEIT_NOTIZ[einsicht] ?? ''].filter(
    Boolean
  );
  return {
    title: abstimmung.titel,
    subtitle: [
      `Abstimmung von ${abstimmung.erstelltVonName}`,
      `erstellt am ${formatDateTime(abstimmung.erstelltAm)}`,
      abstimmung.geschlossen ? 'beendet' : 'läuft noch',
    ].join(' · '),
    notes,
    sections,
    landscape:
      einsicht === 'alles' &&
      abstimmung.optionen.length > MAX_HOCHKANT_OPTIONEN &&
      abstimmung.optionen.length <= MAX_MATRIX_OPTIONEN,
    fileName: pdfFileName('Abstimmung', abstimmung.titel),
  };
}

export async function downloadAbstimmungPdf(abstimmung: AbstimmungDetail): Promise<void> {
  await downloadReportPdf(abstimmungPdfReport(abstimmung));
}
