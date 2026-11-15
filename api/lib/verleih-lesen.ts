import { getDb, toVersion } from './db';
import type { VerleihVorgang } from './verleih-model';
export async function getVerleih(): Promise<VerleihVorgang[]> {
  const db = getDb();
  const [vorgaenge, positionen, verlauf, mails] = await Promise.all([
    db.selectFrom('organisation.verleih').selectAll().orderBy('id', 'desc').execute(),
    db
      .selectFrom('organisation.verleih_position as p')
      .innerJoin('organisation.inventar_variante as i', 'i.id', 'p.variante_id')
      .select([
        'p.id',
        'p.verleih_id',
        'p.variante_id',
        'p.bezeichnung',
        'p.menge',
        'p.zurueck',
        'i.artikel_id',
      ])
      .execute(),
    db.selectFrom('organisation.verleih_verlauf').selectAll().orderBy('id').execute(),
    db
      .selectFrom('organisation.verleih_mail')
      .select(['verleih_id'])
      .where('gesendet', '=', false)
      .execute(),
  ]);
  return vorgaenge.map((v) => ({
    id: v.id,
    etag: toVersion(v.version),
    status: v.status,
    antragsteller: v.antragsteller,
    entleiher: v.entleiher,
    kontakt: v.kontakt,
    verantwortlich: v.verantwortlich,
    von: v.von,
    bis: v.bis,
    notizen: v.notizen,
    entscheidung: v.entscheidung,
    entschiedenVon: v.entschieden_von,
    positionen: positionen
      .filter((p) => p.verleih_id === v.id)
      .map((p) => ({
        id: p.id,
        varianteId: p.variante_id,
        artikelId: p.artikel_id,
        bezeichnung: p.bezeichnung,
        menge: p.menge,
        zurueck: p.zurueck,
      })),
    verlauf: verlauf
      .filter((e) => e.verleih_id === v.id)
      .map((e) => ({ am: e.am.toISOString(), von: e.von, text: e.text })),
    mailOffen: mails.filter((m) => m.verleih_id === v.id).length,
  }));
}
