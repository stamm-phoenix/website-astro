import { CONFIG } from './config';
import { dailyLimit, isDeploymentConfigured, requestStructuredOutput } from './azure-openai';
import { MAX_EINLEITUNG, MAX_ZEITBLOCK_TEXT, MAX_ZEITBLOECKE_PRO_TAG } from './abrechnung-session';

/**
 * Reads the Zeitplan of an Aktion from a file the leaders already have (a photo or the pages of a
 * PDF as JPEG, or the text of an Excel sheet) to prefill the Kurzbeschreibung for the KJR. Uses
 * the deployment of the receipt check (`CONFIG.belege.check`, Data Zone Standard, EU only); the
 * result is only a proposal the page shows for editing.
 */

/**
 * Static Web Apps end a request after 45 seconds. Copying a Zeitplan needs little thinking, so
 * the model thinks `low` and answers well within that, also for a long camp.
 */
const REQUEST_TIMEOUT_MS = 38_000;
/** A long camp has a hundred blocks; the model's thinking counts against this as well. */
const MAX_COMPLETION_TOKENS = 12_000;
export const MAX_ZEITPLAN_BILDER = 4;
/** Text of an Excel file handed to the model; a Zeitplan is far shorter. */
export const MAX_ZEITPLAN_TEXT = 30_000;
const MAX_TAGE = 31;

export interface GelesenerBlock {
  von: string;
  bis: string;
  text: string;
}

export interface GelesenerZeitplan {
  /** Sentence about the aim of the Aktion, if the file has one. */
  einleitung: string | null;
  tage: { datum: string; bloecke: GelesenerBlock[] }[];
}

export interface ZeitplanAktion {
  title: string;
  /** `YYYY-MM-DD` or null without dates in CampFlow. */
  start: string | null;
  end: string | null;
}

export type ZeitplanQuelle = { bilder: Uint8Array[] } | { text: string };

export class ZeitplanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZeitplanError';
  }
}

export class ZeitplanLimitError extends ZeitplanError {
  constructor() {
    super('Daily limit of Zeitplan reads reached');
    this.name = 'ZeitplanLimitError';
  }
}

export function isZeitplanConfigured(): boolean {
  return (
    isDeploymentConfigured(CONFIG.belege.check) && CONFIG.abrechnung.zeitplanMaxReadsPerDay > 0
  );
}

const takeRead = dailyLimit(() => CONFIG.abrechnung.zeitplanMaxReadsPerDay);

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** The days of the Aktion, e.g. „Sonntag, 2026-05-24“; empty without dates. */
export function aktionTage(start: string | null, end: string | null): string[] {
  const first = start ?? end;
  const last = end ?? start;
  if (!first || !last) return [];
  const days: string[] = [];
  const day = new Date(`${first}T00:00:00Z`);
  const stop = new Date(`${last}T00:00:00Z`);
  while (day <= stop && days.length < MAX_TAGE) {
    days.push(`${WEEKDAYS[day.getUTCDay()]}, ${day.toISOString().slice(0, 10)}`);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

function prompt(aktion: ZeitplanAktion): string {
  const tage = aktionTage(aktion.start, aktion.end);
  return `Du liest den Zeitplan einer Aktion eines Pfadfinderstammes aus einer Datei (Foto, PDF-Seiten oder Tabelle), damit daraus eine Kurzbeschreibung für einen Zuschussantrag wird.

Aktion: ${aktion.title}
${tage.length > 0 ? `Tage der Aktion:\n${tage.join('\n')}` : 'Die Aktion hat noch kein Datum.'}

Gib zurück:
- tage: je Tag des Zeitplans das Datum (YYYY-MM-DD) und seine Blöcke in der Reihenfolge der Datei. Steht in der Datei nur ein Wochentag oder „Tag 1“, ordne ihn dem passenden Tag der Aktion zu. Tage ohne Blöcke weglassen.
- bloecke: von und bis als HH:MM (24 Stunden, z. B. „8-9 Uhr“ → von 08:00, bis 09:00; „20.30“ → 20:30). Steht nur eine Uhrzeit oder ein offenes Ende („20.30 – …“), bis leer lassen; ohne Uhrzeit (z. B. „ganztags“) beide leer. text: der Programmpunkt kurz und auf Deutsch, so wie er in der Datei steht, offensichtliche Tippfehler verbessert, höchstens etwa 60 Zeichen. Mehrere Programmpunkte zur selben Zeit in einen Block, mit Komma getrennt.
- einleitung: steht in der Datei ein Satz zu Ziel oder Inhalt der Aktion, diesen Satz; sonst null. Nichts erfinden.

Eine Tabelle kommt als Text: je Zeile die Zellen mit „ | “ getrennt, leere Zellen als leere Felder, sodass die n-te Zelle jeder Zeile in derselben Spalte steht (z. B. ein Tag pro Spalte).

Lies nur, was in der Datei steht. Erfinde keine Programmpunkte, Zeiten oder Tage. Personennamen, Telefonnummern und Adressen nicht übernehmen.`;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['einleitung', 'tage'],
  properties: {
    einleitung: { type: ['string', 'null'] },
    tage: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['datum', 'bloecke'],
        properties: {
          datum: { type: 'string' },
          bloecke: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['von', 'bis', 'text'],
              properties: {
                von: { type: 'string' },
                bis: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `8:00`, `08.00` or `8` as `08:00`; anything else as empty. */
export function normalizeTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/.exec(value);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return '';
  return `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function oneLine(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function isDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** Turns the model's answer into a checked Zeitplan; anything unexpected is dropped. */
export function toZeitplan(raw: unknown): GelesenerZeitplan {
  if (!isRecord(raw)) throw new ZeitplanError('Unexpected answer of the model');
  const byDate = new Map<string, GelesenerBlock[]>();
  for (const tag of Array.isArray(raw.tage) ? raw.tage : []) {
    if (!isRecord(tag) || !isDate(tag.datum)) continue;
    const bloecke = (Array.isArray(tag.bloecke) ? tag.bloecke : []).flatMap((block) => {
      if (!isRecord(block)) return [];
      const text = oneLine(block.text, MAX_ZEITBLOCK_TEXT);
      const von = normalizeTime(block.von);
      return text ? [{ von, bis: von ? normalizeTime(block.bis) : '', text }] : [];
    });
    if (bloecke.length === 0) continue;
    byDate.set(tag.datum, [...(byDate.get(tag.datum) ?? []), ...bloecke]);
  }
  const tage = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_TAGE)
    .map(([datum, bloecke]) => ({ datum, bloecke: bloecke.slice(0, MAX_ZEITBLOECKE_PRO_TAG) }));
  const einleitung = oneLine(raw.einleitung, MAX_EINLEITUNG);
  return { einleitung: einleitung || null, tage };
}

export async function readZeitplan(
  aktion: ZeitplanAktion,
  quelle: ZeitplanQuelle
): Promise<GelesenerZeitplan> {
  if (!takeRead()) throw new ZeitplanLimitError();
  const content =
    'text' in quelle
      ? [{ type: 'text', text: quelle.text.slice(0, MAX_ZEITPLAN_TEXT) }]
      : quelle.bilder.map((jpeg) => ({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`,
            detail: 'high',
          },
        }));
  const answer = await requestStructuredOutput(
    { ...CONFIG.belege.check, reasoningEffort: 'low' },
    {
      schemaName: 'zeitplan',
      schema: RESPONSE_SCHEMA,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      messages: [
        { role: 'system', content: prompt(aktion) },
        { role: 'user', content },
      ],
    }
  );
  return toZeitplan(answer);
}
