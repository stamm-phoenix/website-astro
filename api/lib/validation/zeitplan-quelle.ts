/**
 * The file or description of a request to read a Zeitplan: JPEG pages or photos, an Excel or CSV
 * file as text, or a free description. The endpoint answers with one message, so `readQuelle`
 * returns the first one; where a rule only makes sense after another (the number of images before
 * the images, the file before its text), the schema pipes them in that order.
 */
import { z } from 'zod';
import { isJpeg } from '../jpeg';
import {
  MAX_ZEITPLAN_BILDER,
  MAX_ZEITPLAN_FREITEXT,
  MAX_ZEITPLAN_TEXT,
} from '../kurzbeschreibung-zeitplan';
import type { ZeitplanQuelle } from '../kurzbeschreibung-zeitplan';
import { XlsxError, xlsxToText } from '../xlsx-text';
import { isRecord } from './zod';

/** Per image of a page or photo, as the browser sends them (scaled to 2000 px). */
const MAX_BILD_BYTES = 4 * 1024 * 1024;
const MAX_TABELLE_BYTES = 2 * 1024 * 1024;

const NO_SOURCE = 'Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.';
const NO_FREITEXT = 'Beschreibe zuerst den Ablauf der Aktion.';
const TOO_LONG_FREITEXT = `Die Beschreibung ist zu lang (höchstens ${MAX_ZEITPLAN_FREITEXT.toLocaleString('de-DE')} Zeichen). Kürze sie bitte.`;
const IMAGE_COUNT = `Bitte höchstens ${MAX_ZEITPLAN_BILDER} Seiten oder Fotos auf einmal hochladen.`;
const NOT_READABLE =
  'Die Datei konnte nicht gelesen werden. Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.';
const TABLE_SIZE = 'Die Tabelle ist zu groß (höchstens 2 MB) oder leer.';
const TABLE_FORMAT =
  'Bitte die Tabelle als Excel-Datei (.xlsx) oder CSV speichern und erneut wählen.';
const XLSX_UNREADABLE =
  'Die Excel-Datei konnte nicht gelesen werden. Bitte als .xlsx speichern und erneut wählen.';
const TABLE_EMPTY = 'In der Tabelle steht nichts. Bitte eine andere Datei wählen.';
// Cut off, the Zeitplan on a later sheet would be missing without anyone noticing
const TABLE_LONG =
  'Die Tabelle ist zu lang. Speichere nur das Blatt mit dem Zeitplan in einer eigenen Datei und wähle diese.';

/** A base64 string of one to `maxBytes` bytes, decoded; every fault has the same `message`. */
function bytes(maxBytes: number, message: string) {
  return z
    .string({ error: message })
    .max(Math.ceil((maxBytes * 4) / 3) + 4, { error: message })
    .transform((value) => new Uint8Array(Buffer.from(value, 'base64')))
    .refine((decoded) => decoded.length > 0 && decoded.length <= maxBytes, { error: message });
}

const freitext = z.object({
  art: z.literal('freitext'),
  freitext: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, { error: NO_FREITEXT })
        .max(MAX_ZEITPLAN_FREITEXT, { error: TOO_LONG_FREITEXT })
    )
    .transform((value): ZeitplanQuelle => ({ freitext: value })),
});

const bilder = z.object({
  art: z.literal('bilder'),
  bilder: z
    .array(z.unknown())
    .min(1, { error: IMAGE_COUNT })
    .max(MAX_ZEITPLAN_BILDER, { error: IMAGE_COUNT })
    // Only a list of the right length is looked into
    .pipe(z.array(bytes(MAX_BILD_BYTES, NOT_READABLE).refine(isJpeg, { error: NOT_READABLE })))
    .transform((value): ZeitplanQuelle => ({ bilder: value })),
});

const tabelle = z.object({
  art: z.literal('tabelle'),
  tabelle: z
    .object({
      name: z.string({ error: TABLE_SIZE }),
      data: bytes(MAX_TABELLE_BYTES, TABLE_SIZE),
    })
    .transform(({ name, data }, ctx): string => {
      const fail = (message: string): never => {
        ctx.issues.push({ code: 'custom', message, input: name });
        return z.NEVER;
      };
      if (/\.csv$/i.test(name)) return new TextDecoder().decode(data);
      if (!/\.xlsx$/i.test(name)) return fail(TABLE_FORMAT);
      try {
        return xlsxToText(data);
      } catch (error: unknown) {
        if (error instanceof XlsxError) return fail(XLSX_UNREADABLE);
        throw error;
      }
    })
    .pipe(
      z
        .string()
        .refine((text) => text.trim() !== '', { error: TABLE_EMPTY, abort: true })
        .max(MAX_ZEITPLAN_TEXT, { error: TABLE_LONG })
    )
    .transform((text): ZeitplanQuelle => ({ text })),
});

const none = z.object({ art: z.literal('keine') }).transform((value, ctx): never => {
  ctx.issues.push({ code: 'custom', message: NO_SOURCE, input: value });
  return z.NEVER;
});

/** The description wins over images, and images over a table, as the keys come first. */
export const zeitplanQuelleSchema = z.preprocess(
  (body) => {
    const fields = isRecord(body) ? body : {};
    if (typeof fields.freitext === 'string') return { art: 'freitext', freitext: fields.freitext };
    if (Array.isArray(fields.bilder)) return { art: 'bilder', bilder: fields.bilder };
    if (isRecord(fields.tabelle)) return { art: 'tabelle', tabelle: fields.tabelle };
    return { art: 'keine' };
  },
  z
    .discriminatedUnion('art', [freitext, bilder, tabelle, none])
    .transform((value): ZeitplanQuelle => {
      if ('freitext' in value) return value.freitext;
      if ('bilder' in value) return value.bilder;
      return value.tabelle;
    })
);

/** The source of the request, or the message of the first fault. */
export function readQuelle(body: Record<string, unknown> | null): ZeitplanQuelle | string {
  const result = zeitplanQuelleSchema.safeParse(body);
  return result.success ? result.data : result.error.issues[0].message;
}
