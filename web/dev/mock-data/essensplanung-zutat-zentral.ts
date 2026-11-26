/**
 * The central list and the Planungen in the mock API, like `api/lib/essen-zutat-zentral.ts`: own
 * ingredients of the Planungen taken over, central duplicates merged, and the demo AI that finds
 * duplicates (names that are the same apart from upper and lower case or a plural „n“/„s“).
 */
import type { ZutatInput } from '../../../api/lib/essen-validation';
import type { KiDoppelte, PlanungsZutat } from '../../../api/lib/essen-zutat-zentral-model';
import { leseKiDoppelte } from '../../../api/lib/essen-ki-doppelte-antwort';
import {
  createEssenEintrag,
  deleteEssenEintrag,
  essenAudit,
  essenSteuerungView,
} from './essensplanung';
import type { MockPlanungZutat } from './essensplanung-gerichte';
import type { MockPlanung } from './essensplanung-planung';
import { neuesEtag, planungen } from './essensplanung-planung';

const klein = (name: string) => name.toLocaleLowerCase('de').trim();

export function planungsZutaten(): PlanungsZutat[] {
  const zentral = new Map(essenSteuerungView().zutaten.map((z) => [klein(z.name), z.id]));
  const gruppen = new Map<string, PlanungsZutat>();
  for (const planung of planungen) {
    for (const zutat of planung.zutaten.toReversed()) {
      if (zutat.zutatId !== null || !zutat.name) continue;
      const gruppe = gruppen.get(klein(zutat.name));
      if (gruppe) {
        gruppe.ids.push(zutat.id);
        if (!gruppe.planungen.includes(planung.name)) gruppe.planungen.push(planung.name);
        continue;
      }
      gruppen.set(klein(zutat.name), {
        name: zutat.name,
        ids: [zutat.id],
        planungen: [planung.name],
        kategorieId: zutat.kategorieId!,
        einheitenart: zutat.einheitenart!,
        lebensmittel: zutat.lebensmittel ?? true,
        vegetarisch: zutat.vegetarisch,
        vegan: zutat.vegan,
        allergene: [...zutat.allergene],
        angabenOffen: Boolean(zutat.angabenOffen),
        zentralId: zentral.get(klein(zutat.name)) ?? null,
      });
    }
  }
  return [...gruppen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Like `aufZentraleZutat`: the ingredient of the Planung becomes the central one. */
function aufZentral(planung: MockPlanung, zutat: MockPlanungZutat, zentralId: number): void {
  const vorhanden = planung.zutaten.find((z) => z.zutatId === zentralId && z !== zutat);
  if (vorhanden) {
    const nutzungen = [
      ...planung.gerichte.flatMap((g) => g.zutaten),
      ...planung.bestand,
      ...planung.zusatzbedarf,
      ...planung.tage
        .flatMap((t) => t.mahlzeiten.flatMap((m) => m.einplanungen))
        .flatMap((e) => e.verbrauch),
      ...planung.einkaeufe.flatMap((e) => [...e.posten, ...e.regeln]),
    ];
    for (const nutzung of nutzungen)
      if (nutzung.planungZutatId === zutat.id) nutzung.planungZutatId = vorhanden.id;
    planung.zutaten = planung.zutaten.filter((z) => z !== zutat);
    return;
  }
  Object.assign(zutat, {
    zutatId: zentralId,
    name: null,
    kategorieId: zutat.zutatId === null ? null : zutat.kategorieId,
    einheitenart: zutat.zutatId === null ? null : zutat.einheitenart,
    vegetarisch: null,
    vegan: null,
    allergene: [],
    angabenOffen: false,
    etag: neuesEtag(),
  });
}

function geaendert(planung: MockPlanung, details: Record<string, unknown>): void {
  planung.seq++;
  planung.etag = neuesEtag();
  planung.geaendert = new Date().toISOString();
  planung.aenderungen.unshift({
    seq: planung.seq,
    at: planung.geaendert,
    wer: '',
    aktion: 'zutat-zentral',
    details,
  });
}

/** Like `planungsZutatUebernehmen`; returns a field error or the result. */
export function uebernehmen(
  name: string,
  zielId: number | null,
  zutat: ZutatInput | null
): { field: string; message: string } | { zutatId: number; planungen: number } {
  let zutatId = zielId;
  if (zutatId === null) {
    const result = createEssenEintrag('zutaten', zutat!);
    if (result === 'conflict' || result === 'not-found')
      return { field: 'name', message: 'Bitte neu laden.' };
    if ('field' in result) return result;
    zutatId = result.id!;
  } else if (!essenSteuerungView().zutaten.some((z) => z.id === zielId)) {
    return { field: 'zielId', message: 'Diese Zutat gibt es nicht mehr. Bitte neu laden.' };
  }
  let anzahl = 0;
  for (const planung of planungen) {
    const eigene = planung.zutaten.filter(
      (z) => z.zutatId === null && z.name && klein(z.name) === klein(name)
    );
    if (!eigene.length) continue;
    anzahl++;
    for (const z of eigene) aufZentral(planung, z, zutatId);
    geaendert(planung, { name });
  }
  essenAudit('zutat-uebernommen', { id: zutatId, name, von: name });
  return { zutatId, planungen: anzahl };
}

/** Like `zentraleZutatenZusammenlegen`. */
export function zusammenlegen(von: number, nach: number): number | null {
  const zutaten = essenSteuerungView().zutaten;
  const alt = zutaten.find((z) => z.id === von);
  const bleibt = zutaten.find((z) => z.id === nach);
  if (!alt || !bleibt || von === nach) return null;
  let anzahl = 0;
  for (const planung of planungen) {
    const betroffen = planung.zutaten.filter((z) => z.zutatId === von);
    if (!betroffen.length) continue;
    anzahl++;
    for (const z of betroffen) aufZentral(planung, z, nach);
    geaendert(planung, { name: alt.name, nach: bleibt.name });
  }
  deleteEssenEintrag('zutaten', von, alt.etag);
  essenAudit('zutat-zusammengelegt', { id: nach, name: bleibt.name, von: alt.name });
  return anzahl;
}

/** The demo AI: names alike apart from case and a plural ending are duplicates. */
export function kiDoppelte(): KiDoppelte {
  const zutaten = essenSteuerungView().zutaten;
  const stamm = (name: string) => klein(name).replace(/(n|s|en)$/, '');
  const gruppen = new Map<string, number[]>();
  for (const z of zutaten)
    gruppen.set(stamm(z.name), [...(gruppen.get(stamm(z.name)) ?? []), z.id]);
  return leseKiDoppelte(
    {
      gruppen: [...gruppen.values()]
        .filter((ids) => ids.length > 1)
        .map((ids) => ({
          ids,
          behalten: ids[0],
          grund: 'Demo-KI: gleicher Name bis auf die Endung.',
        })),
    },
    new Set(zutaten.map((z) => z.id))
  );
}
