/** Fotos: the library in SharePoint, with its own preview, download and upload URLs. */
import { mockMitEigenerAdresse } from './mock-data/personen';
import { MOCK_VERSAND_LIST } from './mock-data/protokollEditor';
import {
  mockFotoContent,
  mockFotoDetail,
  mockFotoEnsure,
  mockFotoFolder,
  mockFotoPreview,
  mockFotoUploadPart,
  mockFotoUploadSession,
  mockFotoUploadStatus,
} from './mock-data/fotos';
import { aktionFotoPath, cleanName, splitFotoPath } from '../../api/lib/foto-pfade';
import { error, json, notFound, route, str, strings, svg } from './mockCore';

// ---------------------------------------------------------------------------------------------
// Middleware

// ---------------------------------------------------------------------------------------------
// Fotos: the library in SharePoint, and SharePoint's own preview, download and upload URLs

route('GET', '/api/intern/fotos/ordner', (req) => {
  const path = req.query.get('pfad') ?? '';
  if (!splitFotoPath(path)) return error(400, 'INVALID', 'Ungültiger Ordner.');
  const folder = mockFotoFolder(path);
  return folder
    ? json(folder)
    : notFound(
        'Diesen Ordner gibt es nicht mehr. Vielleicht wurde er in SharePoint umbenannt oder verschoben.'
      );
});

route('GET', '/api/intern/fotos/dateien/:id', (req) => {
  const detail = mockFotoDetail(req.params.id);
  return detail ? json(detail) : notFound('Diese Datei gibt es nicht mehr.');
});

/** The API names the folder of an Aktion upload; the browser may see another first name. */
const MOCK_FOTO_PERSON = 'Demo';

route('GET', '/api/intern/fotos/ziel', () => json({ vorname: MOCK_FOTO_PERSON }));

route('POST', '/api/intern/fotos/ziel', (req) => {
  const body = req.json ?? {};
  let path: string | null;
  if ('aktion' in body) {
    path = aktionFotoPath(str(body.jahr), str(body.aktion), MOCK_FOTO_PERSON);
  } else {
    path = [str(body.pfad), cleanName(str(body.unterordner))].filter(Boolean).join('/');
  }
  if (!path || !splitFotoPath(path))
    return error(400, 'INVALID', 'Bitte wähle einen Ordner aus, nicht die oberste Ebene.');
  return json(mockFotoEnsure(path));
});

route('POST', '/api/intern/fotos/upload', (req) => {
  const body = req.json ?? {};
  const size = Number(body.size);
  if (!str(body.name) || !(size > 0)) return error(400, 'INVALID', 'Ungültige Datei.');
  const reserved = Array.isArray(body.belegt) ? body.belegt.map(String) : [];
  return json(
    mockFotoUploadSession(str(body.pfad), str(body.name), size, {
      newName: body.neu === true,
      reserved,
    })
  );
});

/** The invented CampFlow list, the same as for the minutes. */
const MOCK_FOTO_EMPFAENGER = MOCK_VERSAND_LIST;

/** People of the module „Personen“ to add by hand: one leader on the list, two others. */
export const MOCK_FOTO_PERSONEN = [
  { name: MOCK_VERSAND_LIST[0].name, email: MOCK_VERSAND_LIST[0].email, gruppe: 'leitende' },
  { name: 'Anna Altleiterin', email: 'anna.altleiterin@example.test', gruppe: 'altleitende' },
  { name: 'Otto Ehemalig', email: 'otto.ehemalig@example.test', gruppe: 'altleitende' },
  { name: 'Wanda Weitere', email: 'wanda@example.test', gruppe: 'weitere' },
];

route('POST', '/api/intern/fotos/benachrichtigung', (req) => {
  const body = req.json ?? {};
  if (str(body.action) === 'preview') {
    return json({
      recipients: MOCK_FOTO_EMPFAENGER.length,
      version: 'mock',
      list: mockMitEigenerAdresse(MOCK_FOTO_EMPFAENGER),
      personen: MOCK_FOTO_PERSONEN,
    });
  }
  const excluded = strings(body.excluded);
  const addresses = new Set(
    MOCK_FOTO_EMPFAENGER.map((r) => r.email).filter((address) => !excluded.includes(address))
  );
  for (const address of strings(body.extra)) addresses.add(address.trim().toLowerCase());
  if (addresses.size === 0) return error(400, 'INVALID', 'Es ist niemand ausgewählt.');
  const files = strings(body.dateien).length;
  if (files === 0)
    return error(400, 'INVALID', 'Die Liste der hochgeladenen Dateien ist ungültig.');
  return json({ recipients: addresses.size, files });
});

route(
  'GET',
  '/api/mock-fotos/vorschau/:id',
  (req) => {
    const preview = mockFotoPreview(req.params.id, req.query.has('gross'));
    return preview ? svg(preview) : notFound();
  },
  true
);

route(
  'GET',
  '/api/mock-fotos/datei/:id',
  (req) => {
    const content = mockFotoContent(req.params.id);
    return content
      ? {
          kind: 'raw',
          status: 200,
          contentType: 'application/octet-stream',
          body: content,
          headers: { 'Content-Disposition': 'attachment' },
        }
      : notFound();
  },
  true
);

route(['PUT', 'GET'], '/api/mock-fotos/upload/:id', (req) => {
  const result =
    req.method === 'PUT'
      ? mockFotoUploadPart(req.params.id, req.headers['content-range'], new Uint8Array(req.raw))
      : mockFotoUploadStatus(req.params.id);
  return json(result.body, result.status);
});
