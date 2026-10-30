/**
 * The packing lists of the Planungen in the mock API, like `api/lib/essen-packliste.ts`.
 */
import type {
  PackAenderung,
  PackEintragInput,
  PackZustaendig,
  WerkzeugAenderung,
} from '../../../api/lib/essen-packliste-model';
import { MAX_PACKLISTE, packlisteSchluessel } from '../../../api/lib/essen-packliste-model';
import type { MockZugang } from './essensplanung-planung';
import { aendere, feld, konflikt, neueId, neuesEtag, nichtGefunden } from './essensplanung-planung';

/** A stored entry; who packs it is shown by the member's current name. */
export interface MockPackEintrag {
  id: number;
  etag: string;
  werkzeug: string | null;
  name: string;
  gepackt: boolean;
  zustaendigId: number | null;
  zustaendigText: string;
}

/** The tools of the planned dishes by merged name, with the first name. */
function eingeplanteWerkzeuge(z: MockZugang): Map<string, string> {
  const geplant = new Set(
    z.planung.tage.flatMap((tag) =>
      tag.mahlzeiten.flatMap((m) => m.einplanungen.map((e) => e.gerichtId))
    )
  );
  const werkzeuge = new Map<string, string>();
  for (const gericht of [...z.planung.gerichte].sort((a, b) => a.id - b.id)) {
    if (!geplant.has(gericht.id)) continue;
    for (const name of gericht.werkzeuge) {
      const key = packlisteSchluessel(name);
      if (key && !werkzeuge.has(key)) werkzeuge.set(key, name.trim());
    }
  }
  return werkzeuge;
}

function pruefeZustaendig(z: MockZugang, zustaendig: PackZustaendig, bisher: number | null) {
  if (zustaendig.zustaendigId === null) return zustaendig.zustaendigText;
  const mitglied = z.planung.mitglieder.find((m) => m.id === zustaendig.zustaendigId);
  if (!mitglied || (mitglied.entzogen && mitglied.id !== bisher))
    throw feld('zustaendigId', 'Bitte aus der Liste wählen.');
  return mitglied.name;
}

/** The changed fields and the details of the log entry. */
function werte(z: MockZugang, aenderung: PackAenderung, bisher: number | null) {
  const set: Partial<MockPackEintrag> = {};
  const details: Record<string, unknown> = {};
  if (aenderung.gepackt !== undefined) {
    set.gepackt = aenderung.gepackt;
    details.gepackt = aenderung.gepackt;
  }
  if (aenderung.zustaendig) {
    details.zustaendig = pruefeZustaendig(z, aenderung.zustaendig, bisher);
    set.zustaendigId = aenderung.zustaendig.zustaendigId;
    set.zustaendigText = aenderung.zustaendig.zustaendigText;
  }
  return { set, details };
}

export function packEintragAnlegen(z: MockZugang, input: PackEintragInput): void {
  const eigene = z.planung.packliste.filter((e) => e.werkzeug === null);
  if (eigene.length >= MAX_PACKLISTE)
    throw feld('name', `Höchstens ${MAX_PACKLISTE} eigene Einträge.`);
  const key = packlisteSchluessel(input.name);
  if (eigene.some((e) => packlisteSchluessel(e.name) === key) || eingeplanteWerkzeuge(z).has(key))
    throw feld('name', 'Das steht schon auf der Packliste.');
  pruefeZustaendig(z, input, null);
  aendere(z, 'packliste-neu', { name: input.name }, () => {
    z.planung.packliste.push({
      id: neueId(),
      etag: neuesEtag(),
      werkzeug: null,
      name: input.name,
      gepackt: false,
      zustaendigId: input.zustaendigId,
      zustaendigText: input.zustaendigText,
    });
  });
}

/** Changes (`aenderung`) or deletes (null) a stored entry. */
export function packEintragAendern(
  z: MockZugang,
  id: number,
  aenderung: PackAenderung | null,
  etag: unknown
): void {
  const eintrag = z.planung.packliste.find((e) => e.id === id);
  if (!eintrag) throw nichtGefunden();
  if (!aenderung) {
    if (eintrag.werkzeug !== null)
      throw feld(
        'name',
        'Werkzeuge der Gerichte bleiben auf der Liste, solange ein eingeplantes Gericht sie braucht.'
      );
    if (eintrag.etag !== etag) throw konflikt();
    aendere(z, 'packliste-geloescht', { name: eintrag.name }, () => {
      z.planung.packliste.splice(z.planung.packliste.indexOf(eintrag), 1);
    });
    return;
  }
  const { set, details } = werte(z, aenderung, eintrag.zustaendigId);
  if (eintrag.etag !== etag) throw konflikt();
  aendere(z, 'packliste-geaendert', { name: eintrag.name, ...details }, () => {
    Object.assign(eintrag, set, { etag: neuesEtag() });
  });
}

export function werkzeugSetzen(
  z: MockZugang,
  aenderung: WerkzeugAenderung,
  etag: string | null
): void {
  const key = packlisteSchluessel(aenderung.werkzeug);
  const name = eingeplanteWerkzeuge(z).get(key);
  if (!name) throw feld('werkzeug', 'Kein eingeplantes Gericht braucht dieses Werkzeug mehr.');
  // An entry of its own with this name is the row shown for the tool (see the API)
  if (z.planung.packliste.some((e) => e.werkzeug === null && packlisteSchluessel(e.name) === key))
    throw konflikt();
  const vorhanden = z.planung.packliste.find((e) => e.werkzeug === key);
  const { set, details } = werte(z, aenderung, vorhanden?.zustaendigId ?? null);
  if ((vorhanden?.etag ?? null) !== etag) throw konflikt();
  aendere(z, 'packliste-geaendert', { name, ...details }, () => {
    if (vorhanden) Object.assign(vorhanden, set, { etag: neuesEtag() });
    else
      z.planung.packliste.push({
        id: neueId(),
        etag: neuesEtag(),
        werkzeug: key,
        name,
        gepackt: false,
        zustaendigId: null,
        zustaendigText: '',
        ...set,
      });
  });
}
