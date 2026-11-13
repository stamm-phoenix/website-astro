import { type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { essenMail } from './essen-mails';
import { errorResponse, NO_STORE_HEADERS } from './response-utils';
import { getSiteUrl } from './site-url';
import { isPreviewDeployment } from './staff-auth';

export const CAPTCHA_FAILED: HttpResponseInit = {
  ...errorResponse(
    403,
    'CAPTCHA_FAILED',
    'Die Sicherheitsprüfung ist abgelaufen. Bitte schick das Formular noch einmal ab.'
  ),
  headers: NO_STORE_HEADERS,
};

export const UNAVAILABLE: HttpResponseInit = {
  ...errorResponse(
    503,
    'UNAVAILABLE',
    'Das Formular ist gerade nicht verfügbar. Bitte versuche es später noch einmal.'
  ),
  headers: NO_STORE_HEADERS,
};

export const MAIL_FAILED: HttpResponseInit = {
  ...errorResponse(
    502,
    'MAIL_FAILED',
    'Die Mail konnte nicht verschickt werden. Bitte versuche es in ein paar Minuten noch einmal.'
  ),
  headers: NO_STORE_HEADERS,
};

export function link(request: HttpRequest, path: string, param: string, token: string): string {
  return `${getSiteUrl(request)}${path}#${new URLSearchParams({ [param]: token })}`;
}

export const planungLink = (request: HttpRequest, token: string) =>
  link(request, '/essensplanung/planung', 't', token);

/** Sends a mail, or on a PR preview returns the link it would contain. */
export async function verschicke(
  to: string,
  mail: { subject: string; html: string },
  vorschau: string,
  context: InvocationContext
): Promise<{ gesendet: boolean; vorschauLink?: string }> {
  if (isPreviewDeployment()) return { gesendet: false, vorschauLink: vorschau };
  try {
    await essenMail.send(to, mail.subject, mail.html);
    return { gesendet: true };
  } catch (error: unknown) {
    context.error(
      '[essensplanung] Mail nicht verschickt',
      error instanceof Error ? error.message : error
    );
    return { gesendet: false };
  }
}
