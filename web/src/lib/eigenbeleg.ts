// Eigenbelege: a receipt written by the person who paid, for expenses without an original receipt
// (Leitendenbereich → Eigenbeleg). Nothing is stored; the form only lives while the page is open.
import { parseEuroToCent } from './belege';

export const ZAHLUNGSARTEN = [
  { id: 'bar', label: 'Bar' },
  { id: 'karte', label: 'EC- oder Kreditkarte' },
  { id: 'ueberweisung', label: 'Überweisung' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'sonstige', label: 'Sonstige' },
] as const;
export type Zahlungsart = (typeof ZAHLUNGSARTEN)[number]['id'];

export const GRUENDE = [
  {
    id: 'kein-beleg',
    label: 'Es wurde kein Beleg ausgestellt',
    text: 'Für die Zahlung wurde kein Beleg ausgestellt (z. B. Automat, Trinkgeld, Eintritt ohne Quittung).',
  },
  {
    id: 'verloren',
    label: 'Der Originalbeleg ist verloren gegangen',
    text: 'Der Originalbeleg ist verloren gegangen.',
  },
  {
    id: 'unleserlich',
    label: 'Der Originalbeleg ist unleserlich',
    text: 'Der Originalbeleg ist unleserlich oder beschädigt.',
  },
  { id: 'sonstiges', label: 'Anderer Grund', text: '' },
] as const;
export type Grund = (typeof GRUENDE)[number]['id'];

export interface EigenbelegPosition {
  beschreibung: string;
  /** As typed, e.g. `12,30`. */
  betrag: string;
}

/** The form of an Eigenbeleg, with the values as typed. */
export interface Eigenbeleg {
  /** Who paid and signs the Eigenbeleg. */
  aussteller: string;
  /** Who was paid, e.g. a shop or a person. */
  empfaenger: string;
  /** `YYYY-MM-DD` */
  zahlungsdatum: string;
  zahlungsart: Zahlungsart;
  /** Aktion or purpose, e.g. „Sommerlager 2026“. */
  anlass: string;
  positionen: EigenbelegPosition[];
  grund: Grund;
  /** The reason in own words for `grund: 'sonstiges'`. */
  grundText: string;
  ort: string;
  /** `YYYY-MM-DD`, when the Eigenbeleg is written. */
  datum: string;
}

export type EigenbelegFehler = Partial<
  Record<Exclude<keyof Eigenbeleg, 'positionen'> | `position-${number}`, string>
>;

export const MAX_POSITIONEN = 20;

export function leererEigenbeleg(aussteller: string, heute: string): Eigenbeleg {
  return {
    aussteller,
    empfaenger: '',
    zahlungsdatum: '',
    zahlungsart: 'bar',
    anlass: '',
    positionen: [{ beschreibung: '', betrag: '' }],
    grund: 'kein-beleg',
    grundText: '',
    ort: 'Feldkirchen-Westerham',
    datum: heute,
  };
}

/** Sum of the valid amounts in cent. */
export function eigenbelegSumme(beleg: Eigenbeleg): number {
  return beleg.positionen.reduce((sum, p) => sum + (parseEuroToCent(p.betrag) ?? 0), 0);
}

/** The reason why there is no original receipt, as written on the Eigenbeleg. */
export function grundText(beleg: Eigenbeleg): string {
  if (beleg.grund === 'sonstiges') return beleg.grundText.trim();
  return GRUENDE.find((g) => g.id === beleg.grund)?.text ?? '';
}

/** Messages per field; empty when the Eigenbeleg can be created. */
export function pruefeEigenbeleg(beleg: Eigenbeleg, heute: string): EigenbelegFehler {
  const fehler: EigenbelegFehler = {};
  if (!beleg.aussteller.trim()) fehler.aussteller = 'Bitte gib an, wer bezahlt hat.';
  if (!beleg.empfaenger.trim()) {
    fehler.empfaenger = 'Bitte gib an, wer das Geld bekommen hat.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beleg.zahlungsdatum)) {
    fehler.zahlungsdatum = 'Bitte gib das Datum der Zahlung an.';
  } else if (beleg.zahlungsdatum > heute) {
    fehler.zahlungsdatum = 'Das Datum der Zahlung darf nicht in der Zukunft liegen.';
  }
  if (!beleg.anlass.trim()) fehler.anlass = 'Bitte gib die Aktion oder den Zweck an.';
  beleg.positionen.forEach((position, index) => {
    if (!position.beschreibung.trim()) {
      fehler[`position-${index}`] = 'Bitte beschreibe, was bezahlt wurde.';
    } else if (parseEuroToCent(position.betrag) === null) {
      fehler[`position-${index}`] = 'Bitte gib einen Betrag wie 12,30 an.';
    }
  });
  if (beleg.grund === 'sonstiges' && !beleg.grundText.trim()) {
    fehler.grundText = 'Bitte beschreibe, warum es keinen Originalbeleg gibt.';
  }
  if (!beleg.ort.trim()) fehler.ort = 'Bitte gib den Ort an.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beleg.datum)) fehler.datum = 'Bitte gib das Datum an.';
  else if (beleg.zahlungsdatum && beleg.datum < beleg.zahlungsdatum) {
    fehler.datum = 'Der Eigenbeleg kann erst nach der Zahlung ausgestellt werden.';
  }
  return fehler;
}
