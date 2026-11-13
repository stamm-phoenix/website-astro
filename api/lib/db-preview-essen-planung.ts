import { loadEssenEinstellungen } from './essen-steuerung';
import { sql } from 'kysely';
import { getDb } from './db';
import { anfrageBestaetigen } from './essen-planung';
import { hashToken, neuesToken } from './essen-zugang';

/**
 * An invented Planung for the list in the Steuerung. Nobody gets its links: the owner's token is
 * thrown away, so the test account creates its own Planung to try the pages.
 */
export async function seedPreviewEssensplanungPlanung(now: Date = new Date()): Promise<void> {
  const db = getDb();
  const name = 'Sommerlager (Test)';
  if (await db.selectFrom('essen.planung').select('id').where('name', '=', name).executeTakeFirst())
    return;
  const token = neuesToken();
  const erster = new Date(now.getTime() + 60 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const letzter = new Date(now.getTime() + 66 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  await db
    .insertInto('essen.anlage_anfrage')
    .values({
      token_hash: hashToken(token),
      email: 'vorschau@example.test',
      name: 'Vroni Vorschau',
      planung_name: name,
      erster_tag: erster,
      letzter_tag: letzter,
      laeuft_ab: new Date(now.getTime() + 60 * 60_000),
    })
    .execute();
  // The invented address is no address of the Stamm, so the Steuerung's release does not apply
  await anfrageBestaetigen(token, { freigabePruefen: false });
}

/**
 * An invented dish in the invented Planung: a central ingredient with an amount, one of the
 * Planung's own without, tools and instructions. Only while the Planung has no dish yet.
 */
export async function seedPreviewEssensplanungGerichte(): Promise<void> {
  const db = getDb();
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  const vorhanden = await db
    .selectFrom('essen.gericht')
    .select('id')
    .where('planung_id', '=', planung.id)
    .top(1)
    .executeTakeFirst();
  if (vorhanden) return;
  const zentral = await db
    .selectFrom('essen.zutat')
    .select('id')
    .where('name', '=', 'Kidneybohnen')
    .executeTakeFirst();
  const kategorie = await db
    .selectFrom('essen.kategorie')
    .select('id')
    .top(1)
    .executeTakeFirstOrThrow();
  await db.transaction().execute(async (trx) => {
    const { id: gericht } = await trx
      .insertInto('essen.gericht')
      .values({
        planung_id: planung.id,
        name: 'Chili sin Carne (Test)',
        personen: 20,
        anleitung: 'Zwiebeln anbraten, Bohnen und Gewürze dazu, eine Stunde köcheln lassen.',
        werkzeuge: JSON.stringify(['Großer Topf (Test)', 'Kochlöffel']),
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const { id: gewuerz } = await trx
      .insertInto('essen.planung_zutat')
      .values({
        planung_id: planung.id,
        name: 'Gewürzmischung (Test)',
        kategorie_id: kategorie.id,
        einheitenart: 'masse',
        vegetarisch: true,
        vegan: true,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const zeilen: {
      planung_zutat_id: number;
      menge: number | null;
      einheit: 'kg' | null;
      hinweis: string;
    }[] = [{ planung_zutat_id: gewuerz, menge: null, einheit: null, hinweis: 'nach Geschmack' }];
    if (zentral) {
      const { id: bohnen } = await trx
        .insertInto('essen.planung_zutat')
        .values({ planung_id: planung.id, zutat_id: zentral.id })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      zeilen.unshift({ planung_zutat_id: bohnen, menge: 2, einheit: 'kg', hinweis: '' });
    }
    await trx
      .insertInto('essen.gericht_zutat')
      .values(
        zeilen.map((zeile, index) => ({
          ...zeile,
          gericht_id: gericht,
          position: index + 1,
          fuer_alles: true,
          fuer_vegetarisch: true,
          fuer_vegan: true,
        }))
      )
      .execute();
  });
}

/** Invented entries in the log of the Essensplanung-Steuerung; the settings stay as migrated. */
export async function seedPreviewEssensplanung(): Promise<void> {
  const db = getDb();
  const vorhanden = await db.selectFrom('essen.audit_log').select('id').top(1).executeTakeFirst();
  if (vorhanden) return;
  await db
    .insertInto('essen.audit_log')
    .values([
      {
        actor: 'Vroni Vorschau',
        action: 'zutat-geaendert',
        details: JSON.stringify({ id: 0, name: 'Honig (Test)' }),
      },
      {
        actor: 'Theo Test',
        action: 'kategorie-umbenannt',
        details: JSON.stringify({ id: 0, name: 'Backwaren (Test)', vorher: 'Backware' }),
      },
    ])
    .execute();
}

/** Plans the test dish at the first lunch of the invented Planung, unless it is planned. */
export async function seedPreviewEssensplanungEinplanung(): Promise<void> {
  const db = getDb();
  const gericht = await db
    .selectFrom('essen.gericht as g')
    .innerJoin('essen.planung as p', 'p.id', 'g.planung_id')
    .select(['g.id', 'g.planung_id'])
    .where('p.name', '=', 'Sommerlager (Test)')
    .where('g.name', '=', 'Chili sin Carne (Test)')
    .executeTakeFirst();
  if (!gericht) return;
  const geplant = await db
    .selectFrom('essen.einplanung')
    .select('id')
    .where('gericht_id', '=', gericht.id)
    .top(1)
    .executeTakeFirst();
  if (geplant) return;
  const mahlzeit = await db
    .selectFrom('essen.mahlzeit as m')
    .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
    .select('m.id')
    .where('t.planung_id', '=', gericht.planung_id)
    .orderBy('t.datum')
    .orderBy(sql`CASE WHEN m.name = N'Mittagessen' THEN 0 ELSE 1 END`)
    .orderBy('m.position')
    .top(1)
    .executeTakeFirst();
  if (!mahlzeit) return;
  await db
    .insertInto('essen.einplanung')
    .values({
      mahlzeit_id: mahlzeit.id,
      gericht_id: gericht.id,
      position: 1,
      faktor: 1,
      zustaendig_mitglied_id: null,
      zustaendig_text: 'Küchenteam (Test)',
    })
    .execute();
}

/** Invented participants for the invented Planung, unless it has some. */
export async function seedPreviewEssensplanungTeilnehmende(): Promise<void> {
  const db = getDb();
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  const vorhanden = await db
    .selectFrom('essen.teilnehmende')
    .select('id')
    .where('planung_id', '=', planung.id)
    .top(1)
    .executeTakeFirst();
  if (vorhanden) return;
  const ladeGruppen = () =>
    db
      .selectFrom('essen.planung_gruppe')
      .select(['id', 'name'])
      .where('planung_id', '=', planung.id)
      .orderBy('position')
      .execute();
  let gruppen = await ladeGruppen();
  if (!gruppen.length) {
    // Seeded after migration 0058, so without the groups of the template yet
    const { einstellungen } = await loadEssenEinstellungen(db);
    if (einstellungen.vorlageGruppen.length) {
      await db
        .insertInto('essen.planung_gruppe')
        .values(
          einstellungen.vorlageGruppen.map((gruppe, index) => ({
            planung_id: planung.id,
            position: index + 1,
            name: gruppe.name,
            faktor: gruppe.faktor,
          }))
        )
        .execute();
    }
    gruppen = await ladeGruppen();
  }
  if (gruppen.length < 2) return;
  const mahlzeiten = await db
    .selectFrom('essen.mahlzeit as m')
    .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
    .select('m.id')
    .where('t.planung_id', '=', planung.id)
    .orderBy('t.datum')
    .orderBy('m.position')
    .execute();
  const gluten = await db
    .selectFrom('essen.unvertraeglichkeit')
    .select('id')
    .where('schluessel', '=', 'gluten')
    .executeTakeFirst();
  const [erste, zweite] = gruppen;
  const letzte = gruppen.at(-1)!;
  await db.transaction().execute(async (trx) => {
    const zeilen = [
      { gruppe_id: erste.id, ernaehrung: 'alles' as const, anzahl: 12, hinweis: '' },
      { gruppe_id: erste.id, ernaehrung: 'vegetarisch' as const, anzahl: 4, hinweis: '' },
      {
        gruppe_id: zweite.id,
        ernaehrung: 'vegan' as const,
        anzahl: 2,
        hinweis: 'reisen früher ab (Test)',
        bis_mahlzeit_id: mahlzeiten[Math.min(5, mahlzeiten.length - 1)]?.id ?? null,
      },
      { gruppe_id: letzte.id, ernaehrung: 'alles' as const, anzahl: 6, hinweis: '' },
    ];
    for (const zeile of zeilen) {
      const { id } = await trx
        .insertInto('essen.teilnehmende')
        .values({ planung_id: planung.id, von_mahlzeit_id: null, bis_mahlzeit_id: null, ...zeile })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      if (zeile.ernaehrung === 'vegetarisch' && gluten) {
        await trx
          .insertInto('essen.teilnehmende_unvertraeglichkeit')
          .values({ teilnehmende_id: id, unvertraeglichkeit_id: gluten.id })
          .execute();
      }
    }
    // The first breakfast is only for the leaders' group (setting up)
    if (mahlzeiten[0]) {
      await trx
        .insertInto('essen.mahlzeit_ohne_gruppe')
        .values(
          gruppen
            .filter((gruppe) => gruppe.id !== letzte.id)
            .map((gruppe) => ({ mahlzeit_id: mahlzeiten[0].id, gruppe_id: gruppe.id }))
        )
        .execute();
    }
  });
}
