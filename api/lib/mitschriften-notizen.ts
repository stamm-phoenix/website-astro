import { requestStructuredOutput } from './azure-openai';
import { CONFIG } from './config';
import type {
  MitschriftAbschnitt,
  MitschriftNotizen,
  MitschriftSprecher,
  MitschriftTodo,
} from './mitschriften-model';
import { MAX_NOTE_ITEMS, MAX_NOTE_LENGTH, sprecherLabel } from './mitschriften-model';

/**
 * Notes of a Mitschrift written by Azure OpenAI from the transcript, in a fixed structure
 * (structured outputs). The transcript is sent to the model and nowhere else; errors and logs
 * never contain it (`azure-openai.ts`).
 */

/** About 150 000 tokens; longer transcripts are cut at the end (a meeting of many hours). */
const MAX_TRANSCRIPT_CHARS = 600_000;
const TIMEOUT_MS = 40_000;

/** Running notes during the meeting, or the more thorough pass at its end. */
export type NotizenPass = 'laufend' | 'abschluss';

const PROMPT = `Du schreibst die Notizen einer Besprechung von Leitenden eines Pfadfinderstammes (DPSG Stamm Phoenix) aus einem automatisch erstellten Transkript. Die Sprechertrennung ist automatisch: „Raum – Sprecher 2“ ist eine Stimme im Raum, „Teams – Sprecher 1“ eine Stimme aus dem Teams-Call; manche Sprecher haben schon Namen. Die Erkennung macht Fehler, besonders bei Namen und Fachbegriffen (Wölflinge, Jupfis, Pfadis, Rover, Stavo, Leitendenrunde, Jurte, Kohte …).

Fülle diese Abschnitte, jeweils knapp, sachlich und auf Deutsch:
- beschluesse: was ausdrücklich beschlossen oder fest vereinbart wurde, je ein Satz.
- todos: Aufgaben, die jemand übernommen hat oder übernehmen soll. aufgabe: was zu tun ist. verantwortlich: der Name wie gesagt, sonst die Sprecherbezeichnung, sonst null. frist: wie genannt; ergänze bei relativen Angaben („nächsten Freitag“) das Datum ausgehend vom Datum der Besprechung, sonst null.
- offenePunkte: Fragen und Themen, die offen blieben, vertagt wurden oder noch geklärt werden müssen.
- naechsterTermin: Datum, Uhrzeit und Ort der nächsten Besprechung, wie besprochen (bei relativen Angaben mit Datum), sonst null.

Regeln:
- Nur, was im Transkript steht. Erfinde nichts, auch keine Namen; im Zweifel weglassen.
- Keine Wiedergabe von Small Talk, Wortmeldungen oder Diskussionsverläufen, nur die Ergebnisse.
- Korrigiere offensichtliche Erkennungsfehler bei Begriffen, wenn sie eindeutig sind.
- Leere Listen sind in Ordnung, wenn es nichts dazu gibt.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['beschluesse', 'todos', 'offenePunkte', 'naechsterTermin'],
  properties: {
    beschluesse: { type: 'array', items: { type: 'string' } },
    todos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['aufgabe', 'verantwortlich', 'frist'],
        properties: {
          aufgabe: { type: 'string' },
          verantwortlich: { type: ['string', 'null'] },
          frist: { type: ['string', 'null'] },
        },
      },
    },
    offenePunkte: { type: 'array', items: { type: 'string' } },
    naechsterTermin: { type: ['string', 'null'] },
  },
};

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, MAX_NOTE_LENGTH) : null;
}

function readTexts(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map(readText)
    .filter((text): text is string => text !== null)
    .slice(0, MAX_NOTE_ITEMS);
}

/**
 * Turns an answer of the model or stored JSON into notes; anything unexpected is dropped, so
 * the result always has the fixed structure.
 */
export function toNotizen(raw: unknown): MitschriftNotizen {
  const value = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const todos = (Array.isArray(value.todos) ? value.todos : [])
    .flatMap((entry: unknown): MitschriftTodo[] => {
      const todo =
        entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const aufgabe = readText(todo.aufgabe);
      return aufgabe
        ? [{ aufgabe, verantwortlich: readText(todo.verantwortlich), frist: readText(todo.frist) }]
        : [];
    })
    .slice(0, MAX_NOTE_ITEMS);
  return {
    beschluesse: readTexts(value.beschluesse),
    todos,
    offenePunkte: readTexts(value.offenePunkte),
    naechsterTermin: readText(value.naechsterTermin),
  };
}

/** Reads stored notes; invalid JSON yields `null`. */
export function parseStoredNotizen(value: string | null): MitschriftNotizen | null {
  if (value === null) return null;
  try {
    return toNotizen(JSON.parse(value));
  } catch {
    return null;
  }
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

/** The transcript as lines „[12:03] Raum – Sprecher 2: …“, in the order they were said. */
export function transcriptText(
  abschnitte: MitschriftAbschnitt[],
  sprecher: MitschriftSprecher[]
): string {
  const labels = new Map(sprecher.map((s) => [s.id, sprecherLabel(s.source, s.number, s.name)]));
  const text = [...abschnitte]
    .sort((a, b) => a.startMs - b.startMs || a.id - b.id)
    .map((a) => {
      const label = (a.sprecherId !== null && labels.get(a.sprecherId)) || 'Unbekannt';
      return `[${clock(a.startMs)}] ${label}: ${a.text}`;
    })
    .join('\n');
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text;
}

/** Whether the model for the notes is configured. */
export function isNotizenConfigured(): boolean {
  const { endpoint, deployment } = CONFIG.mitschriften.notes;
  return endpoint !== '' && deployment !== '';
}

/**
 * Writes the notes of a transcript. The pass at the end lets the model think first; the
 * running notes during the meeting answer directly.
 */
export async function generateNotizen(
  meeting: { title: string; date: string },
  transcript: string,
  pass: NotizenPass
): Promise<MitschriftNotizen> {
  const raw = await requestStructuredOutput(CONFIG.mitschriften.notes, {
    schemaName: 'mitschrift_notizen',
    schema: SCHEMA,
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: `Besprechung: ${meeting.title}\nDatum der Besprechung: ${meeting.date}\n\nTranskript:\n${transcript}`,
      },
    ],
    maxCompletionTokens: pass === 'abschluss' ? 16_000 : 4_000,
    timeoutMs: TIMEOUT_MS,
    ...(pass === 'abschluss' ? { reasoningEffort: 'low' as const } : {}),
  });
  return toNotizen(raw);
}
