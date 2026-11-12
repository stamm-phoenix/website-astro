import type { MockRequest, MockResult } from './mockApi';
import type { KorrekturVorschlag } from '../../api/lib/protokoll-korrektur-model';
import {
  fehlendeAngaben,
  passtNoch,
  wendeKorrekturAn,
} from '../../api/lib/protokoll-korrektur-model';
import type { ProtokollInhalt, ProtokollPunkt } from '../../api/lib/protokoll-editor-model';
import {
  MOCK_EDITOR_LOGIN,
  addMockEditorRevision,
  mockEditorEtag,
  mockEditorProtokolle,
} from './mock-data/protokollEditor';

/**
 * Demo of the correction proposals (#553): instead of the language model, a few typical
 * misspellings are looked up in the texts, followed by the notes about missing details.
 */

const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', status, body });
const error = (status: number, code: string, message: string): MockResult =>
  json({ error: code, code, message }, status);

const TIPPFEHLER: [string, string][] = [
  ['Zeltlagr', 'Zeltlager'],
  ['Sommerlagr', 'Sommerlager'],
  ['nähmlich', 'nämlich'],
  ['seperat', 'separat'],
  ['Standart', 'Standard'],
  ['vorraus', 'voraus'],
  ['entgültig', 'endgültig'],
  ['bischen', 'bisschen'],
  ['wiederspricht', 'widerspricht'],
  ['Termien', 'Termine'],
];

function demoVorschlaege(inhalt: ProtokollInhalt): Omit<KorrekturVorschlag, 'id'>[] {
  const result: Omit<KorrekturVorschlag, 'id'>[] = [];
  const pruefe = (punkt: ProtokollPunkt): void => {
    for (const feld of ['titel', 'text'] as const) {
      for (const [falsch, richtig] of TIPPFEHLER) {
        const vorschlag = {
          punktId: punkt.id,
          feld,
          elementId: null,
          art: 'rechtschreibung' as const,
          vorher: falsch,
          nachher: richtig,
          begruendung: `„${richtig}“ schreibt man so.`,
        };
        if (passtNoch(inhalt, vorschlag)) result.push(vorschlag);
      }
    }
    if (/\bevtl\b|\bggf\b/.test(punkt.text)) {
      const vorher = /\bevtl\b/.test(punkt.text) ? 'evtl' : 'ggf';
      result.push({
        punktId: punkt.id,
        feld: 'text',
        elementId: null,
        art: 'rueckfrage',
        vorher,
        nachher: '',
        begruendung: 'Ist das beschlossen oder noch offen? Schreib es eindeutig.',
      });
    }
    punkt.unterpunkte.forEach(pruefe);
  };
  inhalt.punkte.forEach(pruefe);
  return result;
}

export function registerProtokollKorrekturRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult
  ) => void
): void {
  route('POST', '/api/intern/protokoll-editor/:id/ki/korrekturen', (req) => {
    const p = mockEditorProtokolle.get(Number(req.params.id));
    if (!p) return error(404, 'NOT_FOUND', 'Der Eintrag wurde nicht gefunden.');
    if (p.status !== 'entwurf' && p.status !== 'review') {
      return error(
        409,
        'NOT_EDITABLE',
        'Freigegebene Protokolle bleiben unverändert und werden nicht mehr geprüft.'
      );
    }
    const vorschlaege = [...demoVorschlaege(p.inhalt), ...fehlendeAngaben(p.inhalt)].map(
      (v, index) => ({ ...v, id: `k${index + 1}` })
    );
    return json({ etag: mockEditorEtag(p), vorschlaege, nichtGeprueft: [] });
  });

  route('POST', '/api/intern/pflege/protokoll-editor/:id/korrekturen', (req) => {
    const p = mockEditorProtokolle.get(Number(req.params.id));
    if (!p) return error(404, 'NOT_FOUND', 'Der Eintrag wurde nicht gefunden.');
    if (p.status !== 'entwurf' && p.status !== 'review') {
      return error(
        409,
        'NOT_EDITABLE',
        'Freigegebene Protokolle bleiben unverändert und werden nicht mehr geprüft.'
      );
    }
    if (p.sperre && p.sperre.until > Date.now()) {
      return error(
        423,
        'LOCKED',
        `${p.sperre.name} schreibt gerade am Protokoll. Es wurde nichts geändert. Übernimm die Vorschläge, wenn die Bearbeitung beendet ist.`
      );
    }
    const body = req.json ?? {};
    if (body.etag !== mockEditorEtag(p)) {
      return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
    }
    const vorschlaege = Array.isArray(body.vorschlaege)
      ? (body.vorschlaege as (KorrekturVorschlag & { id: string })[])
      : [];
    let inhalt = p.inhalt;
    const uebernommen: string[] = [];
    const geaendert: string[] = [];
    for (const vorschlag of vorschlaege) {
      const neu = wendeKorrekturAn(inhalt, vorschlag);
      if (neu) {
        inhalt = neu;
        uebernommen.push(vorschlag.id);
      } else geaendert.push(vorschlag.id);
    }
    if (uebernommen.length > 0) {
      addMockEditorRevision(p, 'korrektur');
      p.inhalt = inhalt;
      p.version++;
      p.updatedAt = new Date().toISOString();
      p.updatedBy = MOCK_EDITOR_LOGIN;
    }
    return json({ etag: mockEditorEtag(p), updatedAt: p.updatedAt, uebernommen, geaendert });
  });
}
