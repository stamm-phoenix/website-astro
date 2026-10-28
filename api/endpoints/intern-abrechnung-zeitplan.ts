import { pflegeHandler, ok, readJsonBody } from '../lib/pflege-api';
import { getCampflowEvents } from '../lib/campflow';
import { berlinDay } from '../lib/calendar-day';
import { isJpeg } from '../lib/jpeg';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { XlsxError, xlsxToText } from '../lib/xlsx-text';
import {
  MAX_ZEITPLAN_BILDER,
  MAX_ZEITPLAN_FREITEXT,
  MAX_ZEITPLAN_TEXT,
  ZeitplanLimitError,
  isZeitplanConfigured,
  readZeitplan,
} from '../lib/kurzbeschreibung-zeitplan';
import type { ZeitplanQuelle } from '../lib/kurzbeschreibung-zeitplan';
import { EVENT_ID_PATTERN } from './intern-abrechnung';

/** Per image of a page or photo, as the browser sends them (scaled to 2000 px). */
const MAX_BILD_BYTES = 4 * 1024 * 1024;
const MAX_TABELLE_BYTES = 2 * 1024 * 1024;

function invalid(message: string): ReturnType<typeof errorResponse> {
  return errorResponse(400, 'INVALID', message);
}

function decode(value: unknown, maxBytes: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.length <= maxBytes ? new Uint8Array(bytes) : null;
}

/** The file of the request: JPEG pages or photos, or an Excel or CSV file as text. */
function readQuelle(body: Record<string, unknown> | null): ZeitplanQuelle | string {
  if (typeof body?.freitext === 'string') {
    const freitext = body.freitext.trim();
    if (!freitext) return 'Beschreibe zuerst den Ablauf der Aktion.';
    if (freitext.length > MAX_ZEITPLAN_FREITEXT)
      return `Die Beschreibung ist zu lang (höchstens ${MAX_ZEITPLAN_FREITEXT.toLocaleString('de-DE')} Zeichen). Kürze sie bitte.`;
    return { freitext };
  }
  if (Array.isArray(body?.bilder)) {
    if (body.bilder.length === 0 || body.bilder.length > MAX_ZEITPLAN_BILDER)
      return `Bitte höchstens ${MAX_ZEITPLAN_BILDER} Seiten oder Fotos auf einmal hochladen.`;
    const bilder = body.bilder.map((bild) => decode(bild, MAX_BILD_BYTES));
    if (bilder.some((bild) => bild === null || !isJpeg(bild)))
      return 'Die Datei konnte nicht gelesen werden. Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.';
    return { bilder: bilder as Uint8Array[] };
  }
  const tabelle = body?.tabelle;
  if (tabelle && typeof tabelle === 'object' && !Array.isArray(tabelle)) {
    const { name, data } = tabelle as Record<string, unknown>;
    const bytes = decode(data, MAX_TABELLE_BYTES);
    if (typeof name !== 'string' || !bytes)
      return 'Die Tabelle ist zu groß (höchstens 2 MB) oder leer.';
    if (/\.csv$/i.test(name)) return { text: new TextDecoder().decode(bytes) };
    if (!/\.xlsx$/i.test(name))
      return 'Bitte die Tabelle als Excel-Datei (.xlsx) oder CSV speichern und erneut wählen.';
    try {
      return { text: xlsxToText(bytes) };
    } catch (error: unknown) {
      if (error instanceof XlsxError)
        return 'Die Excel-Datei konnte nicht gelesen werden. Bitte als .xlsx speichern und erneut wählen.';
      throw error;
    }
  }
  return 'Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.';
}

/**
 * POST: reads the Zeitplan of the Aktion from the file in the body (`bilder`: JPEGs as base64,
 * or `tabelle`: `{ name, data }` of an .xlsx or .csv) or from a description (`freitext`), and
 * answers with days and blocks to prefill the Kurzbeschreibung. Nothing is stored. `available` is false without a model.
 */
export const AbrechnungZeitplanEndpoint = pflegeHandler('abrechnung-zeitplan', async (request) => {
  const id = request.params.id ?? '';
  if (!EVENT_ID_PATTERN.test(id) || id.length > 128) return invalid('Ungültige Aktion.');
  if (!isZeitplanConfigured()) return ok({ available: false, zeitplan: null });

  const quelle = readQuelle(await readJsonBody(request));
  if (typeof quelle === 'string') return invalid(quelle);
  if ('text' in quelle && quelle.text.trim() === '')
    return invalid('In der Tabelle steht nichts. Bitte eine andere Datei wählen.');
  // Cut off, the Zeitplan on a later sheet would be missing without anyone noticing
  if ('text' in quelle && quelle.text.length > MAX_ZEITPLAN_TEXT)
    return invalid(
      'Die Tabelle ist zu lang. Speichere nur das Blatt mit dem Zeitplan in einer eigenen Datei und wähle diese.'
    );

  const event = (await getCampflowEvents()).find((entry) => entry.id === id);
  if (!event) return errorResponse(404, 'NOT_FOUND', 'Diese Aktion gibt es nicht mehr.');
  // CampFlow sends plain dates and points in time; the page shows the day in Berlin
  const day = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : berlinDay(date);
  };

  try {
    const zeitplan = await readZeitplan(
      { title: event.title, start: day(event.start_date), end: day(event.end_date) },
      quelle
    );
    return ok({ available: true, zeitplan });
  } catch (error: unknown) {
    if (error instanceof ZeitplanLimitError) {
      return errorResponse(
        429,
        'READ_LIMIT',
        'Für heute wurden schon zu viele Zeitpläne ausgelesen. Trage den Zeitplan bitte selbst ein oder versuche es morgen noch einmal.'
      );
    }
    return errorResponse(
      502,
      'READ_UNAVAILABLE',
      'Der Zeitplan konnte gerade nicht ausgelesen werden. Es wurde nichts geändert. Versuche es gleich noch einmal oder trage ihn selbst ein.'
    );
  }
});
export const AbrechnungZeitplanHandler = withErrorHandling(AbrechnungZeitplanEndpoint);
