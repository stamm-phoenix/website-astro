import { randomBytes } from 'node:crypto';
import { inTransaction } from './db';
import { istStammAdresse } from './essen-leitung-model';
import { legePlanungAn } from './essen-planung-anlegen';
import type { LeitungAnlegenInput } from './essen-planung-model';
import { WARTUNG, hashToken, neuesToken } from './essen-zugang';
import { loadEssenEinstellungen } from './essen-steuerung';

/**
 * Creating a Planung from the Leitendenbereich (`docs/essensplanung.md`, „Zugang aus dem
 * Leitendenbereich“): the login stands for the confirmed address, so the Planung is created at
 * once, with the Leitende:r as owner, and opened with the token of the Leitendenbereich. The
 * owner's link from the mail is not sent; „Meine Planungen“ on the public page gets one.
 */
export async function leitungPlanungAnlegen(
  email: string,
  name: string,
  input: LeitungAnlegenInput
): Promise<{ planungId: number; token: string }> {
  const adresse = email.trim().toLowerCase();
  if (!istStammAdresse(adresse)) throw new Error('Only addresses of the Stamm create here');
  return inTransaction(async (trx) => {
    const { einstellungen } = await loadEssenEinstellungen(trx);
    if (einstellungen.wartung) throw WARTUNG();
    const { planungId, besitzerId } = await legePlanungAn(
      trx,
      { ...input, name, email: adresse, tokenHash: hashToken(neuesToken()) },
      einstellungen
    );
    const token = randomBytes(32).toString('base64url');
    await trx.insertInto('essen.leitung_link').values({ mitglied_id: besitzerId, token }).execute();
    return { planungId, token };
  });
}
