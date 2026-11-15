import type { Db } from './db';
import type { VerleihInput, VerleihPositionInput } from './verleih-model';
import { ValidationError } from './validation/errors';
import { pruefeVerleihBestand } from './verleih-bestand';

/** The caller holds the inventory lock. Returned quantities and position IDs survive edits. */
export async function speichereVerleihPositionen(
  db: Db,
  id: number,
  input: VerleihInput,
  zeitraumGeaendert: boolean
): Promise<boolean> {
  const existing = await db
    .selectFrom('organisation.verleih_position')
    .selectAll()
    .where('verleih_id', '=', id)
    .execute();
  const kept = new Set(input.positionen.map((p) => p.varianteId));
  if (existing.some((p) => !kept.has(p.variante_id) && p.zurueck > 0))
    throw new ValidationError({
      positionen: 'Material mit einer Rückgabe kann nicht entfernt werden.',
    });
  const pruefen: VerleihPositionInput[] = [];
  for (const p of input.positionen) {
    const old = existing.find((e) => e.variante_id === p.varianteId);
    if (p.menge < (old?.zurueck ?? 0))
      throw new ValidationError({
        positionen: 'Die Menge darf nicht kleiner sein als die bereits zurückgegebene Menge.',
      });
    const offen = p.menge - (old?.zurueck ?? 0);
    if (offen > 0 && (zeitraumGeaendert || !old || p.menge > old.menge))
      pruefen.push({ varianteId: p.varianteId, menge: offen });
  }
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  await pruefeVerleihBestand(
    db,
    pruefen,
    input.von,
    input.bis < today ? '9999-12-31' : input.bis,
    id
  );
  for (const p of existing) {
    if (!kept.has(p.variante_id))
      await db.deleteFrom('organisation.verleih_position').where('id', '=', p.id).execute();
  }
  for (const p of input.positionen) {
    const old = existing.find((e) => e.variante_id === p.varianteId);
    if (old) {
      await db
        .updateTable('organisation.verleih_position')
        .set({ menge: p.menge })
        .where('id', '=', old.id)
        .execute();
    } else {
      const artikel = await db
        .selectFrom('organisation.inventar_variante as v')
        .innerJoin('organisation.inventar_artikel as a', 'a.id', 'v.artikel_id')
        .select(['a.bezeichnung as name', 'v.bezeichnung as variante'])
        .where('v.id', '=', p.varianteId)
        .executeTakeFirst();
      if (!artikel)
        throw new ValidationError({ positionen: 'Ein Material wurde entfernt. Bitte neu laden.' });
      await db
        .insertInto('organisation.verleih_position')
        .values({
          verleih_id: id,
          variante_id: p.varianteId,
          bezeichnung: `${artikel.name}${artikel.variante ? ` · ${artikel.variante}` : ''}`,
          menge: p.menge,
        })
        .execute();
    }
  }
  return input.positionen.every(
    (p) => p.menge === (existing.find((e) => e.variante_id === p.varianteId)?.zurueck ?? 0)
  );
}
