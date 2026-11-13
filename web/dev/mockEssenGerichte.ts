/** Essensplanung: catalog, dishes, AI helpers, Einplanung, groups, participants and shops. */
import { ValidationError } from '../../api/lib/validation/errors';
import { essenEinstellungen, essenKatalog } from './mock-data/essensplanung';
import type * as essenPlanung from './mock-data/essensplanung-planung';
import * as essenGerichte from './mock-data/essensplanung-gerichte';
import * as essenEinplanung from './mock-data/essensplanung-einplanung';
import * as essenTeilnehmende from './mock-data/essensplanung-teilnehmende';
import * as essenEinkauf from './mock-data/essensplanung-einkauf';
import * as essenKi from './mock-data/essensplanung-ki';
import * as essenKiGericht from './mock-data/essensplanung-ki-gericht';
import * as essenEinheiten from './mock-data/essensplanung-einheiten';
import { validateEinheiten } from '../../api/lib/essen-einheiten-schema';
import * as essenKochen from './mock-data/essensplanung-kochen';
import { validateAbhaken } from '../../api/lib/essen-kochen-validation';
import { validateGeschaeft, validateZutatGeschaeft } from '../../api/lib/essen-einkauf-validation';
import { validateGruppe, validateTeilnehmende } from '../../api/lib/essen-teilnehmende-validation';
import {
  validateGericht,
  validateNeuesGericht,
  validateGerichtZutat,
  validatePlanungZutat,
  readKopf,
  readPersonenSetzen,
} from '../../api/lib/essen-gerichte-validation';
import { readPosition, validateEinplanung } from '../../api/lib/essen-planung-validation';
import { error, json, route, str } from './mockCore';
import type { MockRequest, MockResult } from './mockCore';
import { essenAendern, essenFehler, essenZugang } from './mockEssenCommon';

// Invented Leitende for „Leitende einladen“; the real API reads the team „Leitende“
route('GET', '/api/essensplanung/planung/leitende', (req) => {
  try {
    const zugang = essenZugang(req);
    if (zugang.zugang === 'lesen')
      return error(403, 'NICHT_ERLAUBT', 'Mitglieder einladen dürfen nur Besitzer:innen.');
    return json({
      leitende: [
        { name: 'Anna Ast', email: 'anna.ast@example.test' },
        { name: 'Ben Brot', email: 'ben.brot@example.test' },
        { name: 'Demo Leitung', email: 'leitung@example.test' },
        { name: 'Zoe Zelt', email: 'zoe.zelt@example.test' },
      ],
    });
  } catch (caught) {
    return essenFehler(caught);
  }
});

route('GET', '/api/essensplanung/planung/katalog', (req) => {
  try {
    essenZugang(req);
    return json(essenKatalog());
  } catch (caught) {
    return essenFehler(caught);
  }
});

route('POST', '/api/essensplanung/planung/zutaten', (req) => {
  const input = validatePlanungZutat(req.json, { eigene: true });
  return essenAendern(req, (z) => ({ id: essenGerichte.eigeneZutatAnlegen(z, input) }), 201);
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/zutaten/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenGerichte.planungZutatLoeschen(z, id, req.headers['if-match'])
    );
  return essenAendern(req, (z) =>
    essenGerichte.planungZutatAendern(z, id, req.json, req.json?.etag)
  );
});

route('POST', '/api/essensplanung/planung/gerichte', (req) => {
  const { gericht, einplanung } = validateNeuesGericht(req.json);
  return essenAendern(
    req,
    (z) => ({ id: essenGerichte.gerichtAnlegen(z, gericht, einplanung) }),
    201
  );
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/gerichte/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenGerichte.gerichtAendern(z, id, null, req.headers['if-match'])
    );
  const input = validateGericht(req.json, { neu: false });
  return essenAendern(req, (z) => essenGerichte.gerichtAendern(z, id, input, req.json?.etag));
});

route('POST', '/api/essensplanung/planung/gerichte/:id/zutaten', (req) => {
  const input = validateGerichtZutat(req.json);
  const id = Number(req.params.id);
  return essenAendern(
    req,
    (z) => essenGerichte.gerichtZutatAnlegen(z, id, input, readPosition(req.json?.position)),
    201
  );
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/gericht-zutaten/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenGerichte.gerichtZutatAendern(z, id, null, req.headers['if-match'])
    );
  const input = { ...validateGerichtZutat(req.json), position: readPosition(req.json?.position) };
  return essenAendern(req, (z) => {
    essenKi.pruefePersonenDerZeile(z, id, req.json?.personen);
    essenGerichte.gerichtZutatAendern(z, id, input, req.json?.etag);
  });
});

route('POST', '/api/essensplanung/planung/gerichte/:id/zutaten/sammel', (req) => {
  const zeilen = Array.isArray(req.json?.zeilen) ? req.json.zeilen : [];
  let kopf: ReturnType<typeof readKopf>;
  try {
    kopf = readKopf(req.json);
  } catch (caught) {
    if (!(caught instanceof ValidationError)) throw caught;
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', caught.fields);
  }
  if (!zeilen.length && !kopf)
    return error(400, 'INVALID', 'Bitte mindestens eine Zutat auswählen.', {
      zeilen: 'Bitte mindestens eine Zutat auswählen.',
    });
  const fields: Record<string, string> = {};
  const inputs = zeilen.flatMap((zeile, index) => {
    try {
      return [validateGerichtZutat(zeile)];
    } catch (caught) {
      if (!(caught instanceof ValidationError)) throw caught;
      for (const [feld, text] of Object.entries(caught.fields))
        fields[`zeilen.${index}.${feld}`] = text;
      return [];
    }
  });
  if (Object.keys(fields).length)
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', fields);
  const id = Number(req.params.id);
  const personen =
    typeof req.json?.personen === 'number' || req.json?.personen === null
      ? (req.json.personen as number | null)
      : undefined;
  let personenSetzen: number | undefined;
  try {
    personenSetzen = readPersonenSetzen(req.json);
  } catch (caught) {
    if (!(caught instanceof ValidationError)) throw caught;
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', caught.fields);
  }
  return essenAendern(
    req,
    (z) => essenKi.gerichtZutatenSammeln(z, id, inputs, personen, personenSetzen, kopf),
    201
  );
});

/** A question to the demo AI; „KI-Fehler“ answers 429 with Retry-After like a busy deployment. */
function essenKiFrage(
  req: MockRequest,
  frage: (z: essenPlanung.MockZugang, wartung: boolean) => unknown
) {
  try {
    return json(frage(essenZugang(req), essenEinstellungen().wartung));
  } catch (caught) {
    if (!(caught instanceof essenKi.MockKiBesetzt)) return essenFehler(caught);
    return {
      kind: 'raw',
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': String(caught.retryAfter) },
      body: JSON.stringify({
        error: 'KI_NICHT_VERFUEGBAR',
        code: 'KI_NICHT_VERFUEGBAR',
        message: caught.message,
        retryAfter: caught.retryAfter,
      }),
    } satisfies MockResult;
  }
}

route('POST', '/api/essensplanung/planung/gerichte/:id/ki/pruefen', (req) =>
  essenKiFrage(req, (z, wartung) => essenKi.kiPruefen(z, Number(req.params.id), wartung))
);

route('POST', '/api/essensplanung/planung/gerichte/:id/ki/rezept', (req) => {
  const text = str(req.json?.text).trim();
  if (!text)
    return error(400, 'INVALID', 'Bitte ein Rezept einfügen.', {
      text: 'Bitte ein Rezept einfügen.',
    });
  return essenKiFrage(req, (z, wartung) =>
    essenKi.kiRezept(z, Number(req.params.id), text, wartung)
  );
});

route('POST', '/api/essensplanung/planung/gerichte/:id/ki/generieren', (req) => {
  const beschreibung = str(req.json?.beschreibung).trim();
  if (!beschreibung)
    return error(400, 'INVALID', 'Bitte beschreiben, was es geben soll.', {
      beschreibung: 'Bitte beschreiben, was es geben soll.',
    });
  return essenKiFrage(req, (z, wartung) =>
    essenKiGericht.kiGenerieren(z, Number(req.params.id), beschreibung, wartung)
  );
});

route('POST', '/api/essensplanung/planung/ki/umrechnung', (req) => {
  const zutatId = Number(req.json?.zutatId);
  const planungZutatId = Number(req.json?.planungZutatId);
  const mass = ['tl', 'el', 'stueck'].find((entry) => entry === req.json?.mass) as
    'tl' | 'el' | 'stueck' | undefined;
  if (!mass)
    return error(400, 'INVALID', 'Bitte TL, EL oder Stück wählen.', {
      mass: 'Bitte TL, EL oder Stück wählen.',
    });
  const wahl = zutatId > 0 ? { zutatId } : { planungZutatId };
  return essenKiFrage(req, (z, wartung) => essenKi.kiUmrechnung(z, wahl, mass, wartung));
});

route('POST', '/api/essensplanung/planung/einplanungen', (req) => {
  const input = validateEinplanung(req.json);
  return essenAendern(
    req,
    (z) => essenEinplanung.einplanen(z, input, readPosition(req.json?.position)),
    201
  );
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/einplanungen/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenEinplanung.einplanungAendern(z, id, null, req.headers['if-match'])
    );
  const input = validateEinplanung(req.json);
  return essenAendern(req, (z) =>
    essenEinplanung.einplanungAendern(
      z,
      id,
      input,
      req.json?.etag,
      readPosition(req.json?.position)
    )
  );
});

route('PUT', '/api/essensplanung/planung/einplanungen/:id/status', (req) => {
  const input = validateAbhaken(req.json);
  return essenAendern(req, (z) =>
    essenKochen.einplanungAbhaken(z, Number(req.params.id), input, req.json?.etag)
  );
});

route('POST', '/api/essensplanung/planung/gruppen', (req) => {
  const input = validateGruppe(req.json);
  return essenAendern(req, (z) => essenTeilnehmende.gruppeAnlegen(z, input), 201);
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/gruppen/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenTeilnehmende.gruppeAendern(z, id, null, req.headers['if-match'])
    );
  const input = validateGruppe(req.json);
  return essenAendern(req, (z) => essenTeilnehmende.gruppeAendern(z, id, input, req.json?.etag));
});

route('POST', '/api/essensplanung/planung/teilnehmende', (req) => {
  const input = validateTeilnehmende(req.json);
  return essenAendern(req, (z) => essenTeilnehmende.teilnehmendeAnlegen(z, input), 201);
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/teilnehmende/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenTeilnehmende.teilnehmendeAendern(z, id, null, req.headers['if-match'])
    );
  const input = validateTeilnehmende(req.json);
  return essenAendern(req, (z) =>
    essenTeilnehmende.teilnehmendeAendern(z, id, input, req.json?.etag)
  );
});

route('PUT', '/api/essensplanung/planung/mahlzeiten/:id/gruppen', (req) => {
  const gruppeId = req.json?.gruppeId;
  if (
    typeof gruppeId !== 'number' ||
    !Number.isInteger(gruppeId) ||
    gruppeId <= 0 ||
    typeof req.json?.isst !== 'boolean'
  )
    return error(400, 'INVALID', 'Die Eingaben sind unvollständig oder ungültig.', {
      gruppeId: 'Bitte eine Gruppe wählen.',
    });
  const isst = req.json.isst;
  return essenAendern(req, (z) =>
    essenTeilnehmende.mahlzeitGruppe(z, Number(req.params.id), gruppeId, isst)
  );
});

route('POST', '/api/essensplanung/planung/geschaefte', (req) => {
  const input = validateGeschaeft(req.json);
  return essenAendern(req, (z) => essenEinkauf.geschaeftAnlegen(z, input), 201);
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/geschaefte/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenEinkauf.geschaeftAendern(z, id, null, req.headers['if-match'])
    );
  const input = validateGeschaeft(req.json);
  return essenAendern(req, (z) => essenEinkauf.geschaeftAendern(z, id, input, req.json?.etag));
});

route('PUT', '/api/essensplanung/planung/zutaten/:id/einheiten', (req) => {
  const zeilen = validateEinheiten(req.json);
  return essenAendern(req, (z) =>
    essenEinheiten.einheitenUebernehmen(z, Number(req.params.id), zeilen)
  );
});

route('POST', '/api/essensplanung/planung/ki/einheiten', (req) => {
  const id = Number(req.json?.planungZutatId);
  if (!Number.isInteger(id) || id <= 0)
    return error(400, 'INVALID', 'Bitte eine Zutat wählen.', {
      planungZutatId: 'Bitte eine Zutat wählen.',
    });
  return essenKiFrage(req, (z, wartung) => essenEinheiten.kiEinheiten(z, id, wartung));
});

route('PUT', '/api/essensplanung/planung/zutaten/:id/geschaeft', (req) => {
  const geschaeftId = validateZutatGeschaeft(req.json);
  return essenAendern(req, (z) =>
    essenEinkauf.zutatGeschaeft(z, Number(req.params.id), geschaeftId, req.json?.etag)
  );
});
