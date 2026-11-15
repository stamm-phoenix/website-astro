import type { Db } from './db';
import { reservierterBestand } from './verleih-model';
import type { VerleihPositionInput } from './verleih-model';
import { ValidationError } from './validation/errors';

/** Caller holds the shared inventory/verleih lock until its transaction commits. */
export async function pruefeVerleihBestand(
  db: Db,
  positionen: VerleihPositionInput[],
  von: string,
  bis: string,
  ohne?: number
): Promise<void> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  for (const p of positionen) {
    const artikel = await db
      .selectFrom('organisation.inventar_variante as v')
      .innerJoin('organisation.inventar_artikel as a', 'a.id', 'v.artikel_id')
      .select(['v.bestand', 'a.zustand', 'a.fehlend', 'a.bezeichnung'])
      .where('v.id', '=', p.varianteId)
      .executeTakeFirst();
    if (!artikel)
      throw new ValidationError({
        positionen: 'Ein ausgewähltes Material wurde entfernt. Bitte neu laden.',
      });
    const reservations = await db
      .selectFrom('organisation.verleih_position as p')
      .innerJoin('organisation.verleih as v', 'v.id', 'p.verleih_id')
      .select(['v.id', 'v.von', 'v.bis', 'v.status', 'p.menge', 'p.zurueck'])
      .where('p.variante_id', '=', p.varianteId)
      .where('v.status', 'in', ['genehmigt', 'ausgegeben'])
      .execute();
    const used = reservierterBestand(
      reservations
        .filter((r) => r.id !== ohne)
        .map((r) => ({
          von: r.von,
          bis: r.bis,
          menge: r.menge - r.zurueck,
          ueberfaellig: r.bis < today,
        })),
      von,
      bis
    );
    const available =
      artikel.zustand === 'defekt' || artikel.zustand === 'reparatur' || artikel.fehlend
        ? 0
        : Math.max(0, artikel.bestand - used);
    if (p.menge > available)
      throw new ValidationError({
        positionen: `${artikel.bezeichnung}: Im gewählten Zeitraum sind ${available} verfügbar. Bitte Mengen oder Zeitraum ändern.`,
      });
  }
}

/** Protect variants referenced by history; stock changes cannot invalidate a live reservation. */
export async function pruefeInventurVerleih(
  db: Db,
  artikelId: number,
  varianten: { id: number | null; bestand: number }[]
): Promise<void> {
  const rows = await db
    .selectFrom('organisation.verleih_position as p')
    .innerJoin('organisation.inventar_variante as i', 'i.id', 'p.variante_id')
    .innerJoin('organisation.verleih as v', 'v.id', 'p.verleih_id')
    .select(['p.variante_id', 'p.menge', 'p.zurueck', 'v.von', 'v.bis', 'v.status'])
    .where('i.artikel_id', '=', artikelId)
    .execute();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  for (const row of rows) {
    const variant = varianten.find((v) => v.id === row.variante_id);
    if (!variant)
      throw new ValidationError({
        varianten:
          'Diese Größe oder Variante wird in einer Ausleihe verwendet und kann nicht entfernt werden.',
      });
    const reservations = rows
      .filter(
        (r) => r.variante_id === row.variante_id && ['genehmigt', 'ausgegeben'].includes(r.status)
      )
      .map((r) => ({
        von: r.von,
        bis: r.bis,
        menge: r.menge - r.zurueck,
        ueberfaellig: r.bis < today,
      }));
    const minimum = reservierterBestand(reservations, '0001-01-01', '9998-12-31');
    if (variant.bestand < minimum)
      throw new ValidationError({
        varianten: `Der Bestand darf nicht kleiner als die bereits reservierte Menge (${minimum}) sein. Bitte zuerst die Ausleihen klären.`,
      });
  }
}
