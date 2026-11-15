import { app } from '@azure/functions';
import { staffHandler } from '../lib/handler';
import { hasTeam } from '../lib/staff-auth';
import { getVerleih } from '../lib/verleih-lesen';
import { changeVerleih, saveVerleih } from '../lib/verleih-schreiben';
import { getVerleihEinstellung, saveVerleihEinstellung } from '../lib/verleih-einstellung';
import { sendVerleihMails } from '../lib/verleih-mail';
import {
  validateVerleih,
  validateVerleihAktion,
  validateVerleihAnfrageId,
} from '../lib/validation/verleih';
import { readJsonBody } from '../lib/response-utils';
import { NOT_FOUND, ok, readEtag, requireEtag } from '../lib/pflege-api';
import { parseId } from '../lib/db';
import { getSiteUrl } from '../lib/site-url';
import { getTaskDirectoryUsers } from '../lib/task-directory';
import { labeledText, lenientObject, parseWith } from '../lib/validation/zod';

const FORBIDDEN = {
  status: 403,
  jsonBody: { message: 'Du darfst diese Aktion nicht ausführen. Es wurde nichts gespeichert.' },
};
const settingsSchema = lenientObject({ materialwart: labeledText('den Materialwart', 254) });
export const VerleihCollection = staffHandler('verleih', async (request, _context, principal) => {
  const login = principal.userDetails.toLowerCase();
  const settings = await getVerleihEinstellung();
  if (request.method === 'GET')
    return ok({
      vorgaenge: await getVerleih(),
      materialwart: settings.materialwart,
      login,
      darfEinrichten: hasTeam(principal, 'vorstand') || hasTeam(principal, 'admin'),
    });
  const body = await readJsonBody(request);
  const id = await saveVerleih(
    validateVerleih(body),
    login,
    undefined,
    undefined,
    validateVerleihAnfrageId(body)
  );
  return ok({ id, mailGesendet: await sendVerleihMails(id, getSiteUrl(request)) }, 201);
});
export const VerleihItem = staffHandler('verleih', async (request, _context, principal) => {
  const id = parseId(request.params.id ?? '');
  if (!id) return NOT_FOUND;
  const body = await readJsonBody(request);
  const etag = requireEtag(readEtag(body));
  const login = principal.userDetails.toLowerCase();
  if (request.method === 'PATCH') await saveVerleih(validateVerleih(body), login, id, etag);
  else await changeVerleih(id, etag, validateVerleihAktion(body), login);
  return ok({ id, mailGesendet: await sendVerleihMails(id, getSiteUrl(request)) });
});
export const VerleihVersand = staffHandler('verleih', async (request) => {
  const id = parseId(request.params.id ?? '');
  if (!id) return NOT_FOUND;
  const vorgang = (await getVerleih()).find((v) => v.id === id);
  if (!vorgang) return NOT_FOUND;
  return ok({ mailGesendet: await sendVerleihMails(id, getSiteUrl(request)) });
});
export const VerleihEinstellung = staffHandler('verleih', async (request, _context, principal) => {
  if (!hasTeam(principal, 'vorstand') && !hasTeam(principal, 'admin')) return FORBIDDEN;
  if (request.method === 'GET')
    return ok({ ...(await getVerleihEinstellung()), konten: await getTaskDirectoryUsers() });
  const body = await readJsonBody(request);
  const input = parseWith(settingsSchema, body);
  await saveVerleihEinstellung(input.materialwart, requireEtag(readEtag(body)));
  return ok(await getVerleihEinstellung());
});
app.http('internPflegeVerleih', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/verleih',
  handler: VerleihCollection,
});
app.http('internPflegeVerleihItem', {
  methods: ['PATCH', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/verleih/{id:int}',
  handler: VerleihItem,
});
app.http('internPflegeVerleihVersand', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/verleih/{id:int}/versand',
  handler: VerleihVersand,
});
app.http('internPflegeVerleihEinstellung', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'intern/pflege/verleih/einstellung',
  handler: VerleihEinstellung,
});
