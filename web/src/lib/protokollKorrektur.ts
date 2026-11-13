/**
 * Correction proposals of the Protokoll-Editor (#553): the shared rules of the API and how the
 * page shows a proposal.
 */
import type { ProtokollInhalt } from '../../../api/lib/protokoll-editor-model';
import type { KorrekturFeld, KorrekturVorschlag } from '../../../api/lib/protokoll-korrektur-model';
import {
  KORREKTUR_ART_LABELS,
  feldText,
  findePunkt,
  passtNoch,
  stelleVorhanden,
} from '../../../api/lib/protokoll-korrektur-model';

export type {
  KorrekturArt,
  KorrekturPruefung,
  KorrekturUebernahmeResponse,
  KorrekturVorschlag,
} from '../../../api/lib/protokoll-korrektur-model';
export { KORREKTUR_ART_LABELS, passtNoch };

const FELD_LABELS: Record<KorrekturFeld, string> = {
  titel: 'Titel',
  text: 'Text',
  aufgabe: 'Aufgabe',
  termin: 'Termin',
  'termin-ort': 'Ort des Termins',
};

/** „Rechtschreibung · 2. Sommerlager · Text“: what and where, in the current minutes. */
export function vorschlagOrt(inhalt: ProtokollInhalt, vorschlag: KorrekturVorschlag): string {
  const found = findePunkt(inhalt, vorschlag.punktId);
  const punkt = found
    ? `${found.nummer} ${found.punkt.titel.trim() || 'Ohne Titel'}`
    : 'Punkt gelöscht';
  return [KORREKTUR_ART_LABELS[vorschlag.art], punkt, FELD_LABELS[vorschlag.feld]].join(' · ');
}

/** The task or date a note without a passage is about, e.g. „Zelte prüfen“. */
export function vorschlagBezug(inhalt: ProtokollInhalt, vorschlag: KorrekturVorschlag): string {
  return vorschlag.vorher === '' ? (feldText(inhalt, vorschlag)?.trim() ?? '') : '';
}

/**
 * Whether the text around the proposal changed since the check: a replacement no longer fits,
 * or the passage of a note is gone.
 */
export function textGeaendert(inhalt: ProtokollInhalt, vorschlag: KorrekturVorschlag): boolean {
  return vorschlag.art === 'rueckfrage'
    ? !stelleVorhanden(inhalt, vorschlag)
    : !passtNoch(inhalt, vorschlag);
}
