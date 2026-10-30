/** Validation of the articles and counts of the module „Inventur“ (#107). */
import { z } from 'zod';
import {
  INVENTAR_KATEGORIEN,
  INVENTAR_MAX_BESTAND,
  INVENTAR_MAX_VARIANTEN,
  INVENTAR_ZUSTAENDE,
} from '../inventur-model';
import type { InventarArtikelInput, InventarZaehlungInput } from '../inventur-model';
import { choice, isRecord, labeledText, parseWith } from './zod';

/** A stock: a whole number from 0, so „-3“ and „2,5“ are refused. */
const bestand = z
  .number({ error: 'Bitte für jeden Bestand eine Zahl eintragen.' })
  .int({ error: 'Der Bestand muss eine ganze Zahl sein.' })
  .min(0, { error: 'Der Bestand kann nicht negativ sein.' })
  .max(INVENTAR_MAX_BESTAND, { error: `Der Bestand darf höchstens ${INVENTAR_MAX_BESTAND} sein.` });

const varianten = z
  .array(
    z.object({
      id: z.number().int().positive().nullable().catch(null),
      bezeichnung: labeledText('die Größe oder das Motiv', 100),
      bestand,
    }),
    { error: 'Bitte mindestens einen Bestand angeben.' }
  )
  .min(1, { error: 'Bitte mindestens einen Bestand angeben.' })
  .max(INVENTAR_MAX_VARIANTEN, {
    error: `Es sind höchstens ${INVENTAR_MAX_VARIANTEN} Größen oder Motive möglich.`,
  })
  .superRefine((list, ctx) => {
    if (list.length > 1 && list.some((v) => !v.bezeichnung))
      ctx.addIssue({ code: 'custom', message: 'Bitte jede Größe oder jedes Motiv benennen.' });
    const names = list.map((v) => v.bezeichnung.toLocaleLowerCase('de'));
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Jede Größe oder jedes Motiv darf nur einmal vorkommen.',
      });
  });

const artikelSchema = z.object({
  bezeichnung: labeledText('eine Bezeichnung', 200, true),
  kategorie: choice('die Kategorie', INVENTAR_KATEGORIEN),
  einheit: labeledText('die Einheit', 30, true),
  lagerort: labeledText('den Lagerort', 100),
  zustand: choice('den Zustand', INVENTAR_ZUSTAENDE),
  zubehoer: labeledText('das Zubehör', 1000),
  fehlend: labeledText('die fehlenden Teile', 1000),
  notizen: labeledText('die Notizen', 2000),
  varianten,
});

/** An article to create or change, with all its variants. */
export function validateInventarArtikel(body: unknown): InventarArtikelInput {
  return parseWith(artikelSchema, isRecord(body) ? body : {});
}

const zaehlungSchema = z.object({
  varianten: z
    .array(
      z.object({ id: z.number({ error: 'Die Variante ist ungültig.' }).int().positive(), bestand }),
      {
        error: 'Bitte den gezählten Bestand angeben.',
      }
    )
    .min(1, { error: 'Bitte den gezählten Bestand angeben.' })
    .max(INVENTAR_MAX_VARIANTEN, { error: 'Es sind zu viele Einträge.' }),
});

/** The counted stock of every variant of one article. */
export function validateInventarZaehlung(body: unknown): InventarZaehlungInput {
  return parseWith(zaehlungSchema, isRecord(body) ? body : {});
}
