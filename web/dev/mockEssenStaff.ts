/** Essensplanung: Steuerung and the Plannungen of the logged-in leader. */
import {
  changeEssenEintrag,
  createEssenEintrag,
  deleteEssenEintrag,
  essenSteuerungView,
  saveEssenEinstellungen,
} from './mock-data/essensplanung';
import { essenAudit, essenEinstellungen } from './mock-data/essensplanung';
import * as essenPlanung from './mock-data/essensplanung-planung';
import { leitungPlanungen } from './mock-data/essensplanung-leitung';
import { validateLeitungAnlegen } from '../../api/lib/essen-planung-validation';
import {
  validateEssenEinstellungen,
  validateListName,
  validateZutat,
} from '../../api/lib/essen-validation';
import { error, json, notFound, route } from './mockCore';
import { PRINCIPAL } from './mockAuth';
import { ESSEN_NOT_ALLOWED, essenListe, essenResult } from './mockEssenCommon';
import { kiZentraleZutaten } from './mock-data/essensplanung-ki-zutaten';
import { MockKiBesetzt } from './mock-data/essensplanung-ki';
import { readKiZutatIds } from '../../api/lib/essen-ki-zutaten-antwort';
import { ValidationError } from '../../api/lib/validation/errors';

route('GET', '/api/intern/essensplanung/meine', () =>
  json({ planungen: leitungPlanungen(PRINCIPAL.userDetails) })
);

// Created at once with the mock login as owner, like the real API
route('POST', '/api/intern/essensplanung/meine', (req) => {
  const input = validateLeitungAnlegen(req.json);
  const anfrage = essenPlanung.anfrage({
    ...input,
    email: PRINCIPAL.userDetails,
    name: 'Demo Leitung',
  });
  const token = essenPlanung.bestaetige(
    anfrage,
    essenEinstellungen().vorlageMahlzeiten,
    essenEinstellungen().vorlageGruppen
  );
  return json({ planungId: essenPlanung.zugangVon(token).planung.id, token }, 201);
});

route(
  'GET',
  '/api/intern/essensplanung/steuerung',
  () => ESSEN_NOT_ALLOWED() ?? json(essenSteuerungView())
);

route('PUT', '/api/intern/pflege/essensplanung/einstellungen', (req) => {
  const denied = ESSEN_NOT_ALLOWED();
  if (denied) return denied;
  const einstellungen = validateEssenEinstellungen(req.json?.einstellungen);
  if (!saveEssenEinstellungen(einstellungen, req.json?.etag))
    return error(409, 'CONFLICT', 'Die Einstellungen wurden inzwischen geändert.');
  return json(essenSteuerungView());
});

route('POST', '/api/intern/pflege/essensplanung/:liste', (req) => {
  const liste = essenListe(req.params.liste);
  if (!liste) return notFound();
  const denied = ESSEN_NOT_ALLOWED();
  if (denied) return denied;
  const input = liste === 'zutaten' ? validateZutat(req.json) : validateListName(req.json);
  const result = createEssenEintrag(liste, input);
  return essenResult(result, () => ({
    id: result !== 'conflict' && result !== 'not-found' && 'id' in result ? result.id : 0,
    view: essenSteuerungView(),
  }));
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/essensplanung/:liste/:id', (req) => {
  const liste = essenListe(req.params.liste);
  const id = Number(req.params.id);
  if ((!liste && req.params.liste !== 'planungen') || !Number.isInteger(id)) return notFound();
  const denied = ESSEN_NOT_ALLOWED();
  if (denied) return denied;
  if (!liste) {
    if (req.method !== 'DELETE') return error(405, 'METHOD_NOT_ALLOWED', 'Nicht erlaubt.');
    const result = essenPlanung.planungLoeschenSteuerung(id, req.headers['if-match']);
    if (result === 'not-found') return notFound();
    if (result === 'conflict')
      return error(409, 'CONFLICT', 'Die Planung wurde inzwischen geändert.');
    essenAudit('planung-geloescht', { id });
    return json(essenSteuerungView());
  }
  if (req.method === 'DELETE')
    return essenResult(deleteEssenEintrag(liste, id, req.headers['if-match']), essenSteuerungView);
  const input = liste === 'zutaten' ? validateZutat(req.json) : validateListName(req.json);
  return essenResult(changeEssenEintrag(liste, id, input, req.json?.etag), essenSteuerungView);
});

route('POST', '/api/intern/essensplanung/ki/zutaten', (req) => {
  const denied = ESSEN_NOT_ALLOWED();
  if (denied) return denied;
  const ids = readKiZutatIds(req.json);
  try {
    return json(kiZentraleZutaten(ids));
  } catch (caught) {
    if (!(caught instanceof MockKiBesetzt)) throw caught;
    return error(429, 'KI_NICHT_VERFUEGBAR', caught.message);
  }
});

// „Alle übernehmen“: each entry on its own, like the API
route('POST', '/api/intern/pflege/essensplanung-zutaten/sammel', (req) => {
  const denied = ESSEN_NOT_ALLOWED();
  if (denied) return denied;
  const zutaten: unknown = req.json?.zutaten;
  if (!Array.isArray(zutaten) || !zutaten.length || zutaten.length > 50)
    return error(400, 'INVALID', 'Bitte 1 bis 50 Zutaten auf einmal senden.');
  const ergebnisse = zutaten.map((eintrag: Record<string, unknown>) => {
    const id = Number(eintrag?.id);
    let fehler: string | null = null;
    try {
      const result = changeEssenEintrag('zutaten', id, validateZutat(eintrag), eintrag?.etag);
      if (result === 'conflict')
        fehler = 'Jemand hat die Zutat inzwischen geändert. Prüf sie noch einmal.';
      else if (result === 'not-found') fehler = 'Die Zutat gibt es nicht mehr.';
      else if ('field' in result) fehler = result.message;
    } catch (caught) {
      if (!(caught instanceof ValidationError)) throw caught;
      fehler = Object.values(caught.fields ?? {})[0] ?? caught.message;
    }
    return { id, fehler };
  });
  return json({ ergebnisse, view: essenSteuerungView() });
});
