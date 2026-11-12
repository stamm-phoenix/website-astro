import { z } from 'zod';
import { MAX_WERKZEUGE } from './essen-gerichte-model';
import type { KiGericht } from './essen-ki-model';
import type { RezeptKandidat } from './essen-ki-rezept';
import { leseKiRezept } from './essen-ki-rezept';

/**
 * Reading a dish the AI wrote from a description („Gericht generieren lassen“,
 * `docs/essensplanung.md`, „KI“): the lines go the way of a read recipe (`leseKiRezept`), the
 * instructions and tools are cut to what a dish holds. Without database or network, so the mock
 * API uses it too.
 */

/** As long as the instructions of a dish may be (`essen-gerichte-schema.ts`). */
const MAX_ANLEITUNG = 20_000;

const kopfSchema = z.object({
  anleitung: z.preprocess(
    (value) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''),
    z.string().transform((value) => value.slice(0, MAX_ANLEITUNG))
  ),
  werkzeuge: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown())),
});

/** Tools as a dish keeps them: one line each, at most 100 characters, no doubles, at most 30. */
function werkzeugeVon(werte: readonly unknown[]): string[] {
  const ergebnis: string[] = [];
  for (const wert of werte) {
    if (typeof wert !== 'string') continue;
    const name = wert.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!name || ergebnis.some((other) => other.toLowerCase() === name.toLowerCase())) continue;
    ergebnis.push(name);
    if (ergebnis.length >= MAX_WERKZEUGE) break;
  }
  return ergebnis;
}

/**
 * The dish of the model's answer: its lines mapped onto `kandidaten` and scaled to `personen`
 * like a pasted recipe, with instructions and tools. An answer without any line is unusable.
 */
export function leseKiGericht(
  raw: unknown,
  kandidaten: readonly RezeptKandidat[],
  personen: number | null
): KiGericht {
  const rezept = leseKiRezept(raw, kandidaten, personen);
  if (!rezept.zeilen.length) throw new Error('The dish has no ingredients');
  const kopf = kopfSchema.parse(raw);
  return { ...rezept, anleitung: kopf.anleitung, werkzeuge: werkzeugeVon(kopf.werkzeuge) };
}
