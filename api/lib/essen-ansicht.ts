import type { Db } from './db';
import { getDb, toDateString, toVersion } from './db';
import type { PlanungAenderung, PlanungAnsicht, PlanungMitglied } from './essen-planung-model';
import { darfMitgliederVerwalten, loeschDatum, nummeriereTage } from './essen-planung-model';
import type { PlanungStand } from './essen-stand';
import { ladeStand } from './essen-stand';
import type { Zugang } from './essen-zugang';
import { ladeGerichte } from './essen-gerichte';
import { ladeEinplanungen } from './essen-einplanung';
import { ladeTeilnehmende } from './essen-teilnehmende';
import { ladeEinkauf } from './essen-einkauf';
import { ladeEinkaeufe } from './essen-einkaeufe';
import { ladePackliste } from './essen-packliste';
import { ladeBelege } from './essen-belege';

const AENDERUNGEN_ANZEIGEN = 30;

/**
 * The view of a Planung for the given access. A poll that already read the stand passes it on,
 * so the stand is read once.
 */
export async function ladeAnsicht(
  zugang: Zugang,
  db: Db = getDb(),
  gelesen?: PlanungStand
): Promise<PlanungAnsicht> {
  const { planung, seq, stand, aufbewahrungMonate, wartung, katalogStand } =
    gelesen ?? (await ladeStand(zugang, db));
  const [
    mitglieder,
    tage,
    mahlzeiten,
    aenderungen,
    gerichte,
    einplanungen,
    teilnehmende,
    einkauf,
    einkaeufe,
    packliste,
    belege,
  ] = await Promise.all([
    db
      .selectFrom('essen.mitglied')
      .selectAll()
      .where('planung_id', '=', zugang.planungId)
      .orderBy('id')
      .execute(),
    db.selectFrom('essen.tag').selectAll().where('planung_id', '=', zugang.planungId).execute(),
    db
      .selectFrom('essen.mahlzeit as m')
      .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
      .select(['m.id', 'm.version', 'm.tag_id', 'm.position', 'm.name'])
      .where('t.planung_id', '=', zugang.planungId)
      .execute(),
    db
      .selectFrom('essen.aenderung')
      .selectAll()
      .where('planung_id', '=', zugang.planungId)
      .orderBy('seq', 'desc')
      .top(AENDERUNGEN_ANZEIGEN)
      .execute(),
    ladeGerichte(db, zugang.planungId),
    ladeEinplanungen(db, zugang.planungId),
    ladeTeilnehmende(db, zugang.planungId),
    ladeEinkauf(db, zugang.planungId),
    ladeEinkaeufe(db, zugang.planungId),
    ladePackliste(db, zugang.planungId),
    ladeBelege(db, zugang.planungId),
  ]);

  const verwalten = darfMitgliederVerwalten(zugang.zugang, planung.mitglieder_verwalten);
  const namen = new Map(mitglieder.map((mitglied) => [mitglied.id, mitglied.name]));
  const nummerierteTage = nummeriereTage(
    tage.map((tag) => ({
      id: tag.id,
      etag: toVersion(tag.version),
      datum: toDateString(tag.datum),
    })),
    mahlzeiten.map((mahlzeit) => ({
      id: mahlzeit.id,
      etag: toVersion(mahlzeit.version),
      tagId: mahlzeit.tag_id,
      position: mahlzeit.position,
      name: mahlzeit.name,
      einplanungen: einplanungen.get(mahlzeit.id) ?? [],
      ohneGruppen: teilnehmende.ohneGruppen.get(mahlzeit.id) ?? [],
    }))
  );
  const letzterTag = nummerierteTage.at(-1)?.datum;
  return {
    id: planung.id,
    etag: toVersion(planung.version),
    name: planung.name,
    seq,
    stand,
    zugang: zugang.zugang,
    ichId: zugang.mitgliedId,
    darfVerwalten: verwalten,
    mitgliederVerwalten: planung.mitglieder_verwalten,
    links: verwalten ? { beitritt: planung.beitritt_token, lesen: planung.lese_token } : null,
    tage: nummerierteTage,
    mitglieder: mitglieder
      // The read-only link sees no members; removed ones only those who manage
      .filter((mitglied) => zugang.zugang !== 'lesen' && (verwalten || !mitglied.entzogen_am))
      .map((mitglied): PlanungMitglied => ({
        id: mitglied.id,
        etag: toVersion(mitglied.version),
        name: mitglied.name,
        rolle: mitglied.rolle,
        email: verwalten || mitglied.id === zugang.mitgliedId ? mitglied.email : null,
        entzogen: mitglied.entzogen_am !== null,
        ich: mitglied.id === zugang.mitgliedId,
      })),
    // Without days the day it was created counts, as in the retention run
    loeschtAm: loeschDatum(
      letzterTag ?? planung.erstellt_am.toISOString().slice(0, 10),
      aufbewahrungMonate
    ),
    wartung,
    aenderungen: aenderungen.map((row): PlanungAenderung => ({
      seq: Number(row.seq),
      at: row.at.toISOString(),
      wer: row.mitglied_id === null ? '' : (namen.get(row.mitglied_id) ?? ''),
      aktion: row.aktion,
      details: JSON.parse(row.details) as Record<string, unknown>,
    })),
    katalogStand,
    zutaten: gerichte.zutaten,
    gerichte: gerichte.gerichte,
    gruppen: teilnehmende.gruppen,
    teilnehmende: teilnehmende.teilnehmende,
    geschaefte: einkauf.geschaefte,
    bestand: einkauf.bestand,
    zusatzbedarf: einkauf.zusatzbedarf,
    einkaeufe,
    packliste,
    belege,
  };
}
