import { requestStructuredOutput } from './azure-openai';
import { CONFIG } from './config';
import { VersionConflictError } from './db';
import { getMitschrift, mergeAbschnitte } from './mitschriften';
import type { MitschriftAbschnitt } from './mitschriften-model';

/**
 * Joins sentences the recognition cut apart at a pause to think (`docs/mitschriften.md`).
 * Candidates are sentences of the same source and speaker that follow each other with a short
 * pause; whether they form one sentence is decided by the model of the notes, which only reads
 * the transcript, like for the notes. It may only change punctuation and case at the cut: a
 * suggestion whose words differ from the parts is dropped, so the model never changes what was
 * said.
 */

/** Longest pause between two parts of one sentence that is still considered. */
const MAX_PAUSE_MS = 3000;
/** Pairs per request, so a request stays far below the time limit of the Functions. */
const MAX_PAIRS = 60;
const MAX_TEXT_LENGTH = 4000;
const TIMEOUT_MS = 30_000;

/** Sentences in a row that may be one sentence. */
export interface Run {
  parts: MitschriftAbschnitt[];
}

/** Whether `next` may continue the sentence of `previous`. */
function mayContinue(previous: MitschriftAbschnitt, next: MitschriftAbschnitt): boolean {
  const pause = next.startMs - previous.endMs;
  return (
    previous.source === next.source &&
    previous.sprecherId !== null &&
    previous.sprecherId === next.sprecherId &&
    pause >= -500 &&
    pause <= MAX_PAUSE_MS &&
    previous.text.length + next.text.length < MAX_TEXT_LENGTH
  );
}

/**
 * Runs of candidates among the sentences starting in the window, with at most `maxPairs`
 * pairs. `nextFromMs` is where to go on right away when there were more pairs, else `null`.
 * `resumeFromMs` is where a later look (with more sentences) starts: at the last sentence of
 * each source, so it can still be joined with what follows.
 */
export function findRuns(
  abschnitte: MitschriftAbschnitt[],
  fromMs: number,
  untilMs: number | null,
  maxPairs = MAX_PAIRS
): { runs: Run[]; nextFromMs: number | null; resumeFromMs: number } {
  // Each source by itself: two sources talk at the same time
  const window = abschnitte
    .filter((a) => a.startMs >= fromMs && (untilMs === null || a.startMs < untilMs))
    .sort((a, b) => a.source.localeCompare(b.source) || a.startMs - b.startMs || a.id - b.id);
  const lastStarts = ['raum', 'teams', 'datei'].flatMap((source) => {
    const last = window.filter((a) => a.source === source).at(-1);
    return last ? [last.startMs] : [];
  });
  const resumeFromMs = lastStarts.length > 0 ? Math.min(...lastStarts) : fromMs;
  const runs: Run[] = [];
  let pairs = 0;
  for (let i = 1; i < window.length; i++) {
    const previous = window[i - 1];
    const next = window[i];
    if (!mayContinue(previous, next)) continue;
    if (pairs >= maxPairs) {
      // Go on with this pair next time
      const nextFromMs = Math.min(...window.slice(i - 1).map((a) => a.startMs));
      return { runs, nextFromMs, resumeFromMs: nextFromMs };
    }
    const run = runs.at(-1);
    if (run && run.parts.at(-1) === previous) run.parts.push(next);
    else runs.push({ parts: [previous, next] });
    pairs++;
  }
  return { runs, nextFromMs: null, resumeFromMs };
}

/** Words in order, without punctuation and case: what must stay the same when joining. */
export function wordsOf(text: string): string {
  return text
    .toLocaleLowerCase('de')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface Join {
  parts: MitschriftAbschnitt[];
  text: string;
}

/**
 * The joins of the model's answer that are safe: consecutive parts of one run, each part at
 * most once, and the text has exactly the words of the parts.
 */
export function toJoins(raw: unknown, runs: Run[]): Join[] {
  const answer = (raw as { joins?: unknown })?.joins;
  if (!Array.isArray(answer)) return [];
  const used = new Set<number>();
  const joins: Join[] = [];
  for (const entry of answer) {
    const join = entry as { run?: unknown; from?: unknown; to?: unknown; text?: unknown };
    const run = typeof join.run === 'number' ? runs[join.run] : undefined;
    const { from, to, text } = join;
    if (
      !run ||
      typeof from !== 'number' ||
      typeof to !== 'number' ||
      typeof text !== 'string' ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to >= run.parts.length ||
      to <= from
    ) {
      continue;
    }
    const parts = run.parts.slice(from, to + 1);
    const joined = text.trim().replace(/\s+/g, ' ');
    if (
      parts.some((part) => used.has(part.id)) ||
      !joined ||
      joined.length > MAX_TEXT_LENGTH ||
      wordsOf(joined) !== wordsOf(parts.map((part) => part.text).join(' '))
    ) {
      continue;
    }
    for (const part of parts) used.add(part.id);
    joins.push({ parts, text: joined });
  }
  return joins;
}

const PROMPT = `Du bekommst Ausschnitte aus dem automatischen Transkript einer Besprechung von Pfadfinder-Leitenden. Die Spracherkennung beendet einen Satz, sobald jemand kurz Pause macht, und schneidet so manchmal einen Satz mitten durch, etwa „Also beim Pfingstlager müssen wir noch.“ / „Die Anzahlung überweisen.“

Jeder Lauf enthält nummerierte Teile derselben Person, die direkt aufeinander folgen. Entscheide, welche aufeinanderfolgenden Teile eigentlich ein einziger Satz sind, und gib nur diese als joins an: run, from und to (die Nummern des ersten und letzten Teils) und den zusammengefügten Text.

Regeln für den Text:
- Genau dieselben Wörter in derselben Reihenfolge. Ändere nur Satzzeichen und Groß- und Kleinschreibung an den Schnitten, z. B. den falschen Punkt entfernen und „Die“ zu „die“ machen.
- Füge nichts hinzu, lass nichts weg, korrigiere keine Wörter.

Teile, die eigenständige Sätze sind, lässt du weg. Im Zweifel nicht zusammenfügen.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['joins'],
  properties: {
    joins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['run', 'from', 'to', 'text'],
        properties: {
          run: { type: 'integer' },
          from: { type: 'integer' },
          to: { type: 'integer' },
          text: { type: 'string' },
        },
      },
    },
  },
};

/** Asks the model which parts of the runs form one sentence; only safe joins are returned. */
export async function suggestJoins(runs: Run[]): Promise<Join[]> {
  const listing = runs
    .map(
      (run, index) =>
        `Lauf ${index}:\n` + run.parts.map((part, i) => `  ${i}: ${part.text}`).join('\n')
    )
    .join('\n\n');
  const raw = await requestStructuredOutput(CONFIG.mitschriften.notes, {
    schemaName: 'mitschrift_saetze',
    schema: SCHEMA,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: listing },
    ],
    maxCompletionTokens: 8000,
    timeoutMs: TIMEOUT_MS,
  });
  return toJoins(raw, runs);
}

export interface SmoothResult {
  /** Sentences that were joined into others. */
  merged: number;
  /** Where to go on right away; `null` once everything up to `untilMs` was looked at. */
  nextFromMs: number | null;
  /** Where a later look starts, when more sentences have come in. */
  resumeFromMs: number;
}

/**
 * Joins cut sentences that start between `fromMs` and `untilMs` (`null`: up to the end). A
 * sentence changed in the meantime is skipped. Call again with `nextFromMs` until it is `null`.
 */
export async function smoothAbschnitte(
  mitschriftId: number,
  fromMs: number,
  untilMs: number | null,
  actor: string
): Promise<SmoothResult> {
  const detail = await getMitschrift(mitschriftId);
  if (!detail) return { merged: 0, nextFromMs: null, resumeFromMs: fromMs };
  const { runs, nextFromMs, resumeFromMs } = findRuns(detail.abschnitte, fromMs, untilMs);
  if (runs.length === 0) return { merged: 0, nextFromMs, resumeFromMs };
  let merged = 0;
  for (const join of await suggestJoins(runs)) {
    try {
      await mergeAbschnitte(
        mitschriftId,
        { abschnitte: join.parts.map((p) => ({ id: p.id, etag: p.etag })), text: join.text },
        actor
      );
      merged += join.parts.length - 1;
    } catch (error: unknown) {
      // Changed by someone in the meantime: their version counts
      if (!(error instanceof VersionConflictError)) throw error;
    }
  }
  return { merged, nextFromMs, resumeFromMs };
}
