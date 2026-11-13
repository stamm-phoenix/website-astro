import { app } from '@azure/functions';
import { isAltchaConfigured, verifyAltchaPayload } from '../lib/altcha';
import { bestaetigungMail, meinePlanungenMail } from '../lib/essen-mails';
import { anfrageAnlegen, anfrageBestaetigen } from '../lib/essen-planung-anfragen';
import {
  beitreten,
  beitrittAnsehen,
  linkZuruecknehmen,
  neueLinksFuerAdresse,
} from '../lib/essen-planung-mitglieder';
import { validateAnlegen, validateBeitritt, validateEmail } from '../lib/essen-planung-validation';
import { ok, planungHandler } from '../lib/essen-planung-http';
import { readJsonBody } from '../lib/response-utils';
import {
  CAPTCHA_FAILED,
  UNAVAILABLE,
  MAIL_FAILED,
  link,
  planungLink,
  verschicke,
} from '../lib/essen-planung-versand';

/**
 * Public API of the Essensplanung (`docs/essensplanung.md`). There is no login: the personal or
 * read-only link carries a token, which the page sends in the header `x-essensplanung-token`.
 * Changes answer with the whole view of the Planung, conflicts with status 409 and the current
 * view. PR previews send no mail; they return the link in `vorschauLink(s)` instead.
 */

// ---------------------------------------------------------------------------------------------
// Creating, joining, „Meine Planungen“
// ---------------------------------------------------------------------------------------------

/** POST `{ altcha, email, name, planungName, ersterTag, letzterTag }`: mails the confirmation link. */
export const EssensplanungAnlegen = planungHandler(async (request, context) => {
  if (!isAltchaConfigured()) return UNAVAILABLE;
  const body = await readJsonBody(request);
  const input = validateAnlegen(body);
  if (!(await verifyAltchaPayload(body?.altcha))) return CAPTCHA_FAILED;
  const token = await anfrageAnlegen(input);
  const bestaetigen = link(request, '/essensplanung/bestaetigen', 'a', token);
  const versand = await verschicke(
    input.email,
    bestaetigungMail(input.name, input.planungName, bestaetigen),
    bestaetigen,
    context
  );
  if (!versand.gesendet && !versand.vorschauLink) return MAIL_FAILED;
  return ok(
    versand.vorschauLink
      ? { email: input.email, vorschauLink: versand.vorschauLink }
      : { email: input.email }
  );
});

/** POST `{ token }`: creates the Planung of a confirmed request; answers with the owner's token. */
export const EssensplanungBestaetigen = planungHandler(async (request) => {
  const body = await readJsonBody(request);
  return ok({ token: await anfrageBestaetigen(body?.token) }, 201);
});

/**
 * POST `{ altcha, email }`: mails new links to all Planungen of the address. The answer is the
 * same whether the address is known or not.
 */
export const EssensplanungMeine = planungHandler(async (request, context) => {
  if (!isAltchaConfigured()) return UNAVAILABLE;
  const body = await readJsonBody(request);
  const email = validateEmail(body);
  if (!(await verifyAltchaPayload(body?.altcha))) return CAPTCHA_FAILED;
  const links = await neueLinksFuerAdresse(email);
  const eintraege = links.map((entry) => ({
    planungName: entry.planungName,
    link: planungLink(request, entry.token),
  }));
  let vorschauLinks: typeof eintraege | undefined;
  if (eintraege.length) {
    const versand = await verschicke(email, meinePlanungenMail(eintraege), '', context);
    if (versand.vorschauLink !== undefined) vorschauLinks = eintraege;
    // Without the mail the old links keep working; the answer stays the same for every address
    else if (!versand.gesendet) await Promise.all(links.map(linkZuruecknehmen));
  }
  return ok(vorschauLinks ? { email, vorschauLinks } : { email });
});

/** POST `{ token }`: the name of the Planung behind a join link. */
export const EssensplanungBeitrittAnsehen = planungHandler(async (request) => {
  const body = await readJsonBody(request);
  return ok(await beitrittAnsehen(body?.token));
});

/** POST `{ token, name, email? }`: joins the Planung; answers with the personal token. */
export const EssensplanungBeitreten = planungHandler(async (request) => {
  const body = await readJsonBody(request);
  const input = validateBeitritt(body);
  return ok({ token: await beitreten(body?.token, input) }, 201);
});

// Essensplanung: public, access only by the token of a link (docs/essensplanung.md).
app.http('essensplanungAnlegen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/anlegen',
  handler: EssensplanungAnlegen,
});

app.http('essensplanungBestaetigen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/anlegen/bestaetigen',
  handler: EssensplanungBestaetigen,
});

app.http('essensplanungMeine', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/meine',
  handler: EssensplanungMeine,
});

app.http('essensplanungBeitrittAnsehen', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/beitritt/ansehen',
  handler: EssensplanungBeitrittAnsehen,
});

app.http('essensplanungBeitreten', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'essensplanung/beitritt',
  handler: EssensplanungBeitreten,
});
