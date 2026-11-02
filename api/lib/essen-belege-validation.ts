/**
 * Checks of the requests of the receipts of a Planung. They parse with the schemas of
 * `essen-belege-schema.ts`; the types they return are declared in `essen-belege-model.ts`, which
 * the browser imports and which therefore stays free of zod.
 */
import { z } from 'zod';
import type { BelegAenderung, BelegFotoArt, BelegInput } from './essen-belege-model';
import { BELEG_FOTO_ARTEN } from './essen-belege-model';
import { belegAenderungSchema, belegSchema } from './essen-belege-schema';
import { ValidationError } from './validation/errors';
import { parseWith } from './validation/zod';

/** Today in Germany as `YYYY-MM-DD`; receipts are dated in local time. */
export function heuteInBerlin(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}

export function validateBeleg(input: unknown, heute = heuteInBerlin()): BelegInput {
  const value = parseWith(belegSchema(heute), input);
  return {
    datum: value.datum,
    betragCent: value.betragCent,
    haendler: value.haendler,
    notiz: value.notiz,
    bezahltVonId: value.bezahltVonId,
    bezahltVonText: value.bezahltVonId === null ? value.bezahltVonText : '',
    erstattet: value.erstattet,
  };
}

/** The fields that were sent; at least one. */
export function validateBelegAenderung(input: unknown, heute = heuteInBerlin()): BelegAenderung {
  const value = parseWith(belegAenderungSchema(heute), input);
  const aenderung: BelegAenderung = {};
  if (value.datum !== undefined) aenderung.datum = value.datum;
  if (value.betragCent !== undefined) aenderung.betragCent = value.betragCent;
  if (value.haendler !== undefined) aenderung.haendler = value.haendler;
  if (value.notiz !== undefined) aenderung.notiz = value.notiz;
  if (value.erstattet !== undefined) aenderung.erstattet = value.erstattet;
  if (value.mitBezahltVon) {
    aenderung.bezahltVon = {
      bezahltVonId: value.bezahltVonId,
      bezahltVonText: value.bezahltVonId === null ? value.bezahltVonText : '',
    };
  }
  if (!Object.keys(aenderung).length) {
    throw new ValidationError({ form: 'Es gibt nichts zu speichern.' });
  }
  return aenderung;
}

const fotoArt = z.enum(BELEG_FOTO_ARTEN).catch('bild');

/** The picture asked for; anything unknown is the picture itself. */
export function readBelegFotoArt(value: string | null): BelegFotoArt {
  return fotoArt.parse(value ?? undefined);
}
