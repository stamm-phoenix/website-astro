/** Essensplanung: creating, joining, members, days and meals. */
import { essenEinstellungen } from './mock-data/essensplanung';
import * as essenPlanung from './mock-data/essensplanung-planung';
import {
  readPosition,
  validateAnlegen,
  validateBeitritt,
  validateEinladung,
  validateEmail,
  validateMahlzeit,
  validateMitgliedName,
  validatePlanungEinstellungen,
  validateTag,
} from '../../api/lib/essen-planung-validation';
import { error, json, route } from './mockCore';
import { CAPTCHA_FAILED } from './mockKontakt';
import { essenAendern, essenAnsicht, essenFehler, essenSite, essenZugang } from './mockEssenCommon';

route('POST', '/api/essensplanung/anlegen', (req) => {
  const input = validateAnlegen(req.json);
  if (typeof req.json?.altcha !== 'string') return CAPTCHA_FAILED();
  const einstellungen = essenEinstellungen();
  const domain = input.email.split('@')[1];
  if (
    domain !== 'stamm-phoenix.de' &&
    (!einstellungen.anlegenExtern ||
      (einstellungen.whitelist.length > 0 &&
        !einstellungen.whitelist.some((entry) => entry === input.email || entry === domain)))
  )
    return error(
      403,
      'ANLEGEN_NICHT_ERLAUBT',
      'Mit dieser Mailadresse kannst du gerade keine Planung anlegen.'
    );
  const token = essenPlanung.anfrage(input);
  return json({
    email: input.email,
    vorschauLink: essenSite(req, '/essensplanung/bestaetigen', 'a', token),
  });
});

route('POST', '/api/essensplanung/anlegen/bestaetigen', (req) => {
  try {
    return json(
      {
        token: essenPlanung.bestaetige(
          req.json?.token,
          essenEinstellungen().vorlageMahlzeiten,
          essenEinstellungen().vorlageGruppen
        ),
      },
      201
    );
  } catch (caught) {
    return essenFehler(caught);
  }
});

route('POST', '/api/essensplanung/meine', (req) => {
  const email = validateEmail(req.json);
  if (typeof req.json?.altcha !== 'string') return CAPTCHA_FAILED();
  const links = essenPlanung.neueLinks(email).map((entry) => ({
    planungName: entry.planungName,
    link: essenSite(req, '/essensplanung/planung', 't', entry.token),
  }));
  return json(links.length ? { email, vorschauLinks: links } : { email });
});

route('POST', '/api/essensplanung/beitritt/ansehen', (req) => {
  try {
    return json({ name: essenPlanung.beitrittPlanung(req.json?.token).name });
  } catch (caught) {
    return essenFehler(caught);
  }
});

route('POST', '/api/essensplanung/beitritt', (req) => {
  const input = validateBeitritt(req.json);
  try {
    return json({ token: essenPlanung.beitreten(req.json?.token, input.name, input.email) }, 201);
  } catch (caught) {
    return essenFehler(caught);
  }
});

route(['GET', 'PATCH', 'DELETE'], '/api/essensplanung/planung', (req) => {
  if (req.method === 'GET') {
    try {
      return json(essenAnsicht(essenZugang(req)));
    } catch (caught) {
      return essenFehler(caught);
    }
  }
  if (req.method === 'DELETE') return essenAendern(req, (z) => essenPlanung.planungLoeschen(z));
  const input = validatePlanungEinstellungen(req.json);
  return essenAendern(req, (z) => essenPlanung.planungAendern(z, input));
});

route('GET', '/api/essensplanung/planung/stand', (req) => {
  try {
    const ansicht = essenAnsicht(essenZugang(req));
    return json(
      req.query.get('seit') === ansicht.stand
        ? { stand: ansicht.stand }
        : { stand: ansicht.stand, ansicht }
    );
  } catch (caught) {
    return essenFehler(caught);
  }
});

route('PATCH', '/api/essensplanung/planung/ich', (req) => {
  const name = validateMitgliedName(req.json);
  return essenAendern(req, (z) => essenPlanung.eigenerName(z, name));
});

route('POST', '/api/essensplanung/planung/links', (req) => {
  const art = req.json?.art === 'lesen' ? 'lesen' : 'beitritt';
  return essenAendern(req, (z) => essenPlanung.gemeinsamerLink(z, art, req.json?.an === true));
});

route('POST', '/api/essensplanung/planung/mitglieder', (req) => {
  const input = validateEinladung(req.json);
  return essenAendern(
    req,
    (z) => ({
      gesendet: false,
      vorschauLink: essenSite(req, '/essensplanung/planung', 't', essenPlanung.einladen(z, input)),
    }),
    201
  );
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/mitglieder/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenPlanung.mitgliedAendern(z, id, null, req.headers['if-match'])
    );
  const rolle = req.json?.rolle === 'besitzer' ? 'besitzer' : 'bearbeiten';
  return essenAendern(req, (z) => essenPlanung.mitgliedAendern(z, id, rolle, req.json?.etag));
});

route('POST', '/api/essensplanung/planung/mitglieder/:id/link', (req) =>
  essenAendern(req, (z) => ({
    gesendet: false,
    vorschauLink: essenSite(
      req,
      '/essensplanung/planung',
      't',
      essenPlanung.neuerLink(z, Number(req.params.id)).token
    ),
  }))
);

route('POST', '/api/essensplanung/planung/tage', (req) => {
  const datum = validateTag(req.json);
  return essenAendern(
    req,
    (z) => essenPlanung.tagHinzufuegen(z, datum, essenEinstellungen().vorlageMahlzeiten),
    201
  );
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/tage/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) => essenPlanung.tagAendern(z, id, null, req.headers['if-match']));
  const datum = validateTag(req.json);
  return essenAendern(req, (z) => essenPlanung.tagAendern(z, id, datum, req.json?.etag));
});

route('POST', '/api/essensplanung/planung/mahlzeiten', (req) => {
  const input = validateMahlzeit(req.json);
  const tagId = typeof req.json?.tagId === 'number' ? req.json.tagId : 0;
  return essenAendern(
    req,
    (z) => essenPlanung.mahlzeitHinzufuegen(z, tagId, input, readPosition(req.json?.position)),
    201
  );
});

route(['PATCH', 'DELETE'], '/api/essensplanung/planung/mahlzeiten/:id', (req) => {
  const id = Number(req.params.id);
  if (req.method === 'DELETE')
    return essenAendern(req, (z) =>
      essenPlanung.mahlzeitAendern(z, id, null, req.headers['if-match'])
    );
  const input = { ...validateMahlzeit(req.json), position: readPosition(req.json?.position) };
  return essenAendern(req, (z) => essenPlanung.mahlzeitAendern(z, id, input, req.json?.etag));
});
