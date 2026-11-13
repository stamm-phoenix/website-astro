/** Abstimmungen. */
import {
  mockAbstimmungClosed,
  mockAbstimmungDetail,
  mockAbstimmungOwner,
  mockAbstimmungenList,
  mockCreateAbstimmung,
  mockDeleteAbstimmung,
  mockInvite,
  mockInvited,
  mockMailStand,
  mockPublicAnsicht,
  mockPublicVote,
  mockRemind,
  mockSendMails,
  mockStaffVote,
  mockUpdateAbstimmung,
  resetMockAbstimmungen,
} from './mock-data/abstimmungen';
import { mockMitEigenerAdresse } from './mock-data/personen';
import { MOCK_VERSAND_LIST } from './mock-data/protokollEditor';
import { PRINCIPAL } from './mockAuth';
import { error, json, noContent, notFound, route, str, strings } from './mockCore';
import type { MockResult } from './mockCore';
import { MOCK_FOTO_PERSONEN } from './mockFotos';

// ---------------------------------------------------------------------------------------------
// Abstimmungen

const ABSTIMMUNGEN = '/api/intern/pflege/abstimmungen';
const MOCK_NAME = 'Lea Leitung';
resetMockAbstimmungen(PRINCIPAL.userDetails);
route('POST', '/api/__mock/abstimmungen/reset', () => {
  resetMockAbstimmungen(PRINCIPAL.userDetails);
  return noContent();
});
const ABSTIMMUNG_FORBIDDEN = (): MockResult =>
  error(403, 'FORBIDDEN', 'Nur die Person, die die Abstimmung angelegt hat, kann sie ändern.');
const ABSTIMMUNG_CLOSED = (): MockResult =>
  error(409, 'CLOSED', 'Diese Abstimmung ist beendet. Du kannst nicht mehr abstimmen.');

function abstimmungResult(result: 'conflict' | 'forbidden' | 'missing' | 'ok'): MockResult {
  if (result === 'conflict')
    return error(409, 'CONFLICT', 'Der Eintrag wurde inzwischen geändert. Bitte neu laden.');
  if (result === 'forbidden') return ABSTIMMUNG_FORBIDDEN();
  return result === 'missing' ? notFound() : noContent();
}

route(['GET', 'POST'], ABSTIMMUNGEN, (req) => {
  if (req.method === 'GET') return json(mockAbstimmungenList(PRINCIPAL.userDetails));
  return json({ id: mockCreateAbstimmung(req.json, PRINCIPAL.userDetails, MOCK_NAME) }, 201);
});

route(['GET', 'PATCH', 'DELETE'], `${ABSTIMMUNGEN}/:id`, (req) => {
  const id = Number(req.params.id);
  if (req.method === 'GET') {
    const detail = mockAbstimmungDetail(
      id,
      PRINCIPAL.userDetails,
      req.headers.host ?? 'localhost:4321'
    );
    return detail ? json(detail) : notFound();
  }
  if (req.method === 'DELETE')
    return abstimmungResult(
      mockDeleteAbstimmung(id, str(req.headers['if-match']), PRINCIPAL.userDetails)
    );
  return abstimmungResult(mockUpdateAbstimmung(id, req.json, PRINCIPAL.userDetails));
});

route('PUT', `${ABSTIMMUNGEN}/:id/stimme`, (req) => {
  const result = mockStaffVote(
    Number(req.params.id),
    PRINCIPAL.userDetails,
    MOCK_NAME,
    req.json?.gewaehlt,
    req.json?.vielleicht
  );
  if (result === 'closed') return ABSTIMMUNG_CLOSED();
  return result === 'missing' ? notFound() : noContent();
});

route('POST', `${ABSTIMMUNGEN}/:id/einladung`, (req) => {
  const id = Number(req.params.id);
  if (mockAbstimmungOwner(id) !== PRINCIPAL.userDetails) return ABSTIMMUNG_FORBIDDEN();
  if (mockAbstimmungClosed(id)) return ABSTIMMUNG_CLOSED();
  if (str(req.json?.action) === 'preview') {
    return json({
      recipients: MOCK_VERSAND_LIST.length,
      version: 'mock',
      list: mockMitEigenerAdresse(MOCK_VERSAND_LIST),
      personen: MOCK_FOTO_PERSONEN,
      eingeladen: mockInvited(id),
    });
  }
  const excluded = strings(req.json?.excluded);
  const addresses = new Map(
    MOCK_VERSAND_LIST.filter((r) => !excluded.includes(r.email)).map((r) => [r.email, r.name])
  );
  for (const address of strings(req.json?.extra)) addresses.set(address.trim().toLowerCase(), '');
  if (addresses.size === 0) return error(400, 'INVALID', 'Es ist niemand ausgewählt.');
  const result = mockInvite(
    id,
    [...addresses].map(([email, name]) => ({ email, name }))
  );
  return json({ ...result, ...mockMailStand(id) });
});

route('POST', `${ABSTIMMUNGEN}/:id/erinnerung`, (req) => {
  const id = Number(req.params.id);
  if (mockAbstimmungOwner(id) !== PRINCIPAL.userDetails) return ABSTIMMUNG_FORBIDDEN();
  if (str(req.json?.action) === 'preview') return json({ personen: mockRemind(id, false) });
  return json({ personen: mockRemind(id, true), ...mockMailStand(id) });
});

route('POST', `${ABSTIMMUNGEN}/:id/mails`, (req) => {
  const id = Number(req.params.id);
  if (mockAbstimmungOwner(id) !== PRINCIPAL.userDetails) return ABSTIMMUNG_FORBIDDEN();
  mockSendMails(id);
  return json(mockMailStand(id));
});

route('POST', '/api/abstimmungen/ansehen', (req) => {
  const ansicht = mockPublicAnsicht(req.json ?? {});
  return ansicht
    ? json(ansicht)
    : error(404, 'INVALID_LINK', 'Dieser Link ist ungültig oder die Abstimmung wurde gelöscht.');
});

route('PUT', '/api/abstimmungen/stimme', (req) => {
  const result = mockPublicVote(req.json ?? {});
  if (result === 'closed') return ABSTIMMUNG_CLOSED();
  if (result === 'missing')
    return error(
      404,
      'INVALID_LINK',
      'Dieser Link ist ungültig oder die Abstimmung wurde gelöscht.'
    );
  return json(result);
});
