import { z } from 'zod';
import { labeledText, lenientObject, parseWith, choice } from './zod';
import type { VerleihInput } from '../verleih-model';
const id = z
  .number({ error: 'Bitte gültiges Material auswählen.' })
  .int({ error: 'Die Nummer ist ungültig.' })
  .positive({ error: 'Die Nummer ist ungültig.' });
const menge = z
  .number({ error: 'Bitte eine Menge eintragen.' })
  .int({ error: 'Die Menge muss ganzzahlig sein.' })
  .min(1, { error: 'Die Menge muss mindestens 1 sein.' })
  .max(1_000_000, { error: 'Die Menge ist zu groß.' });
const datum = z
  .string({ error: 'Bitte ein Datum eintragen.' })
  .refine(
    (s) =>
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Number.isFinite(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s,
    { error: 'Bitte ein gültiges Datum eintragen.' }
  );
const schema = lenientObject({
  entleiher: labeledText('die Person oder Gruppe', 200, true),
  kontakt: labeledText('den Kontakt', 254),
  verantwortlich: labeledText('die verantwortliche Person', 200),
  von: datum,
  bis: datum,
  notizen: labeledText('die Notizen', 2000),
  positionen: z
    .array(z.object({ varianteId: id, menge }, { error: 'Bitte Material und Menge auswählen.' }), {
      error: 'Bitte Material auswählen.',
    })
    .min(1, { error: 'Bitte mindestens ein Material auswählen.' })
    .max(60, { error: 'Es sind höchstens 60 Positionen möglich.' }),
}).superRefine((v, ctx) => {
  if (v.bis < v.von)
    ctx.addIssue({
      code: 'custom',
      path: ['bis'],
      message: 'Die Rückgabe darf nicht vor der Ausleihe liegen.',
    });
  if (new Set(v.positionen.map((p) => p.varianteId)).size !== v.positionen.length)
    ctx.addIssue({
      code: 'custom',
      path: ['positionen'],
      message: 'Bitte jede Größe oder Variante nur einmal auswählen.',
    });
});
export function validateVerleih(body: unknown): VerleihInput {
  return parseWith(schema, body);
}
const aktionSchema = lenientObject({
  aktion: choice('die Aktion', ['rueckgabe', 'stornieren'] as const),
  nachricht: labeledText('die Nachricht', 2000),
  rueckgaben: z
    .array(
      z.object(
        { positionId: id, menge, schaden: labeledText('den Schaden', 1000) },
        { error: 'Bitte die Rückgabe prüfen.' }
      ),
      { error: 'Bitte die Rückgaben prüfen.' }
    )
    .max(60, { error: 'Zu viele Rückgaben.' })
    .default([]),
}).superRefine((v, ctx) => {
  if (
    v.aktion === 'rueckgabe' &&
    (!v.rueckgaben.length ||
      new Set(v.rueckgaben.map((r) => r.positionId)).size !== v.rueckgaben.length)
  )
    ctx.addIssue({
      code: 'custom',
      path: ['rueckgaben'],
      message: 'Bitte jede zurückgegebene Position einmal angeben.',
    });
});
export type VerleihAktion = z.infer<typeof aktionSchema>;
export function validateVerleihAktion(body: unknown): VerleihAktion {
  return parseWith(aktionSchema, body);
}

export function validateVerleihAnfrageId(body: unknown): string {
  return parseWith(
    lenientObject({
      anfrageId: z.uuid({
        error: 'Die Eintragung konnte nicht zugeordnet werden. Bitte öffne das Formular erneut.',
      }),
    }),
    body
  ).anfrageId;
}
