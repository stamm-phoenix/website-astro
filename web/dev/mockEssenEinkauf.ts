/** Essensplanung: shopping, Packliste and Belege. */
import { ValidationError } from '../../api/lib/validation/errors';
import * as essenEinkauf from './mock-data/essensplanung-einkauf';
import * as essenPackliste from './mock-data/essensplanung-packliste';
import * as essenBelege from './mock-data/essensplanung-belege';
import {
  readBelegFotoArt,
  validateBeleg,
  validateBelegAenderung,
} from '../../api/lib/essen-belege-validation';
import * as essenEinkaeufe from './mock-data/essensplanung-einkaeufe';
import {
  readHakenEtag,
  validateEinkauf,
  validateHaken,
  validateRegel,
  validateVerschieben,
  validateZurueckholen,
} from '../../api/lib/essen-einkaeufe-validation';
import { validatePosten } from '../../api/lib/essen-einkauf-validation';
import {
  validatePackAenderung,
  validatePackEintrag,
  validateWerkzeugAenderung,
  validateZuteilungAenderung,
} from '../../api/lib/essen-packliste-validation';
import { error, json, notFound, route } from './mockCore';
import { essenAendern, essenFehler, essenZugang } from './mockEssenCommon';

for (const art of ['bestand', 'zusatzbedarf'] as const) {
  route('POST', `/api/essensplanung/planung/${art}`, (req) => {
    const input = validatePosten(req.json, art);
    return essenAendern(req, (z) => essenEinkauf.postenAnlegen(z, art, input), 201);
  });
  route(['PATCH', 'DELETE'], `/api/essensplanung/planung/${art}/:id`, (req) => {
    const id = Number(req.params.id);
    if (req.method === 'DELETE')
      return essenAendern(req, (z) =>
        essenEinkauf.postenAendern(z, art, id, null, req.headers['if-match'])
      );
    const input = validatePosten(req.json, art);
    return essenAendern(req, (z) => essenEinkauf.postenAendern(z, art, id, input, req.json?.etag));
  });
}

route('POST', '/api/essensplanung/planung/einkaeufe', (req) => {
  const input = validateEinkauf(req.json);
  return essenAendern(req, (z) => essenEinkaeufe.einkaufAnlegen(z, input), 201);
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/einkaeufe/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenEinkaeufe.einkaufAendern(z, id, null, req.headers['if-match'])
    );
  const input = validateEinkauf(req.json);
  return essenAendern(req, (z) => essenEinkaeufe.einkaufAendern(z, id, input, req.json?.etag));
});

route('PUT', '/api/essensplanung/planung/einkaeufe/:id/posten', (req) => {
  const input = validateHaken(req.json);
  return essenAendern(req, (z) =>
    essenEinkaeufe.postenAbhaken(z, Number(req.params.id), input, readHakenEtag(req.json ?? null))
  );
});

route('PUT', '/api/essensplanung/planung/einkaeufe/:id/regeln', (req) => {
  const input = validateRegel(req.json);
  return essenAendern(req, (z) => essenEinkaeufe.regelSetzen(z, Number(req.params.id), input));
});

route('POST', '/api/essensplanung/planung/einkaeufe/:id/verschieben', (req) => {
  const input = validateVerschieben(req.json);
  return essenAendern(req, (z) => essenEinkaeufe.verschieben(z, Number(req.params.id), input));
});

route('POST', '/api/essensplanung/planung/einkaeufe/:id/zurueckholen', (req) => {
  const input = validateZurueckholen(req.json);
  return essenAendern(req, (z) => essenEinkaeufe.zurueckholen(z, Number(req.params.id), input));
});

route('DELETE', '/api/essensplanung/planung/einkauf-posten/:id', (req) =>
  essenAendern(req, (z) =>
    essenEinkaeufe.postenAufheben(z, Number(req.params.id), req.headers['if-match'])
  )
);

route('POST', '/api/essensplanung/planung/packliste', (req) => {
  const input = validatePackEintrag(req.json);
  return essenAendern(req, (z) => essenPackliste.packEintragAnlegen(z, input), 201);
});

route('PUT', '/api/essensplanung/planung/packliste/werkzeug', (req) => {
  const input = validateWerkzeugAenderung(req.json);
  const etag = typeof req.json?.etag === 'string' ? req.json.etag : null;
  return essenAendern(req, (z) => essenPackliste.werkzeugSetzen(z, input, etag));
});

route('PATCH', '/api/essensplanung/planung/packliste/zuteilung/:id', (req) => {
  const { gepackt } = validateZuteilungAenderung(req.json);
  return essenAendern(req, (z) =>
    essenPackliste.zuteilungAbhaken(z, Number(req.params.id), gepackt, req.json?.etag)
  );
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/packliste/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenPackliste.packEintragAendern(z, id, null, req.headers['if-match'])
    );
  const input = validatePackAenderung(req.json);
  return essenAendern(req, (z) => essenPackliste.packEintragAendern(z, id, input, req.json?.etag));
});

// Belege of a Planung (docs/essensplanung.md, Belege)
route('POST', '/api/essensplanung/planung/belege', (req) => {
  const input = validateBeleg(req.json);
  return essenAendern(
    req,
    (z) => essenBelege.belegAnlegen(z, input, essenBelege.fotosAus(req.json)),
    201
  );
});

route('POST', '/api/essensplanung/planung/belege/pruefung', (req) => {
  try {
    const zugang = essenZugang(req);
    if (zugang.zugang === 'lesen')
      return error(403, 'NUR_LESEN', 'Mit diesem Link kannst du die Planung nur ansehen.');
  } catch (caught) {
    return essenFehler(caught);
  }
  // The pages of a PDF come as `{ pages }`, a photo as it is
  if (!Array.isArray(req.json?.pages) && (req.raw[0] !== 0xff || req.raw[1] !== 0xd8))
    return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
  return json(essenBelege.demoPruefung(req.query.get('nur') === 'drehung'));
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/belege/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) => essenBelege.belegAendern(z, id, null, req.headers['if-match']));
  const input = validateBelegAenderung(req.json);
  return essenAendern(req, (z) => essenBelege.belegAendern(z, id, input, req.json?.etag));
});

route(
  ['GET', 'PUT', 'DELETE'],
  '/api/essensplanung/planung/belege/:id/foto',
  (req) => {
    const id = Number(req.params.id);
    if (req.method === 'GET') {
      try {
        const datei = essenBelege.belegFoto(
          essenZugang(req),
          id,
          readBelegFotoArt(req.query.get('art'))
        );
        if (!datei) return notFound('Zu diesem Beleg gibt es kein Foto mehr.');
        return { kind: 'raw', status: 200, contentType: datei.typ, body: datei.bytes };
      } catch (caught) {
        return essenFehler(caught);
      }
    }
    if (req.method === 'DELETE')
      return essenAendern(req, (z) =>
        essenBelege.belegFotoSetzen(z, id, null, req.headers['if-match'])
      );
    return essenAendern(req, (z) => {
      const datei = essenBelege.fotosAus(req.json);
      if (!datei)
        throw new ValidationError({ photo: 'Bitte ein Foto oder PDF des Belegs wählen.' });
      essenBelege.belegFotoSetzen(z, id, datei, req.json?.etag);
    });
  },
  true
);
