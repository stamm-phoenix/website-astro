/** Settings of the logged-in leader, recent areas, Neuigkeiten, favorites, Personen and Inventur. */
import { ValidationError } from '../../api/lib/validation/errors';
import {
  validateStaffFavorites,
  validateChangelogSeen,
  validateStaffRecentVisit,
  validateStaffSettings,
} from '../../api/lib/validation/staff';
import { validatePerson } from '../../api/lib/validation/person';
import {
  validateInventarArtikel,
  validateInventarZaehlung,
} from '../../api/lib/validation/inventur';
import {
  addInventarArtikel,
  deleteInventarArtikel,
  inventurListe,
  resetInventur,
  updateInventarArtikel,
  zaehleInventarArtikel,
} from './mock-data/inventur';
import type { Ergebnis as InventurErgebnis } from './mock-data/inventur';
import {
  addPerson,
  deletePerson,
  mockIch,
  personenUebersicht,
  resetPersonen,
  updatePerson,
} from './mock-data/personen';
import { error, json, noContent, notFound, route, str } from './mockCore';
import type { MockResult } from './mockCore';
import { PRINCIPAL } from './mockAuth';

/** Favorites of the start page; `null` until the demo account saves some, like a new account. */
let staffFavorites: string[] | null = null;
export function resetStaffFavorites(): void {
  staffFavorites = null;
}
let staffSettings: Record<string, unknown> = {};
route(['GET', 'PUT'], '/api/intern/einstellungen', (req) => {
  if (req.method === 'GET') return json({ settings: staffSettings });
  staffSettings = { ...staffSettings, ...validateStaffSettings(req.json) };
  return json({ settings: staffSettings });
});
route('POST', '/api/__mock/einstellungen/reset', () => {
  staffSettings = {};
  return noContent();
});

/** Recently opened areas of the demo account, the latest first. */
let staffRecent: string[] = [];
route(['GET', 'POST'], '/api/intern/zuletzt', (req) => {
  if (req.method === 'GET') return json({ modules: staffRecent });
  const module = validateStaffRecentVisit(req.json);
  staffRecent = [module, ...staffRecent.filter((entry) => entry !== module)].slice(0, 8); // MAX_RECENT of the API
  return json({ modules: staffRecent });
});
route('POST', '/api/__mock/zuletzt/reset', () => {
  staffRecent = [];
  return noContent();
});

/** Newest changelog entry the demo account has seen; `null` until the changelog is opened. */
let changelogSeen: string | null = null;
route(['GET', 'PUT'], '/api/intern/neuigkeiten', (req) => {
  if (req.method === 'GET') return json({ lastSeenId: changelogSeen });
  const id = validateChangelogSeen(req.json);
  if (changelogSeen === null || id > changelogSeen) changelogSeen = id;
  return json({ lastSeenId: changelogSeen });
});
route('POST', '/api/__mock/neuigkeiten/reset', (req) => {
  const id = req.json?.lastSeenId;
  changelogSeen = typeof id === 'string' ? id : null;
  return noContent();
});

route(['GET', 'PUT'], '/api/intern/favoriten', (req) => {
  if (req.method === 'GET') return json({ modules: staffFavorites });
  const modules = validateStaffFavorites(req.json);
  if (req.json?.takeover === true) {
    staffFavorites ??= modules;
    return json({ modules: staffFavorites });
  }
  staffFavorites = modules;
  return noContent();
});

route(['GET', 'POST'], '/api/intern/pflege/personen', (req) => {
  if (req.method === 'GET') return json(personenUebersicht());
  const id = addPerson(validatePerson(req.json));
  if (typeof id !== 'number') throw new ValidationError(id);
  return json({ id }, 201);
});

route('GET', '/api/intern/ich', () => json(mockIch(PRINCIPAL.userDetails)));
route('POST', '/api/__mock/personen/reset', () => {
  resetPersonen();
  return noContent();
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/personen/:id', (req) => {
  const id = Number(req.params.id);
  const result =
    req.method === 'DELETE'
      ? deletePerson(id, str(req.headers['if-match']))
      : updatePerson(id, validatePerson(req.json), str(req.json?.etag));
  if (typeof result === 'object') throw new ValidationError(result);
  if (result === 'conflict') {
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  }
  return result ? noContent() : notFound();
});

route(['GET', 'POST'], '/api/intern/pflege/inventur', (req) => {
  if (req.method === 'GET') return json(inventurListe());
  return json({ id: addInventarArtikel(validateInventarArtikel(req.json)) }, 201);
});

route('POST', '/api/__mock/inventur/reset', () => {
  resetInventur();
  return noContent();
});

const inventurErgebnis = (result: InventurErgebnis): MockResult =>
  result === 'missing'
    ? notFound()
    : result === 'conflict'
      ? error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.')
      : noContent();

route('POST', '/api/intern/pflege/inventur/:id/zaehlung', (req) =>
  inventurErgebnis(
    zaehleInventarArtikel(
      Number(req.params.id),
      validateInventarZaehlung(req.json),
      str(req.json?.etag)
    )
  )
);

route(['PATCH', 'DELETE'], '/api/intern/pflege/inventur/:id', (req) =>
  inventurErgebnis(
    req.method === 'DELETE'
      ? deleteInventarArtikel(Number(req.params.id), str(req.headers['if-match']))
      : updateInventarArtikel(
          Number(req.params.id),
          validateInventarArtikel(req.json),
          str(req.json?.etag)
        )
  )
);
