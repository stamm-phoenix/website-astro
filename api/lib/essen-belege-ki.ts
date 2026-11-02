import { AzureOpenAiError } from './azure-openai';
import type { BelegCheck, BelegRotation } from './beleg-check';
import { frageBelegDrehung, frageBelegPruefung } from './beleg-check';
import { CONFIG } from './config';
import { KiNichtVerfuegbar, isKiConfigured } from './essen-ki';
import type { Zugang } from './essen-planung';
import { NUR_LESEN, PlanungError, WARTUNG } from './essen-planung';
import { darfBearbeiten } from './essen-planung-model';
import { loadEssenEinstellungen } from './essen-steuerung';
import { getDb } from './db';

/**
 * The check of a receipt photo in the Essensplanung (`docs/essensplanung.md`, Belege): the same
 * question as in the Belege of the Leitendenbereich (`beleg-check.ts`: is it a receipt, complete,
 * readable; shop, day and amount to prefill), asked of the deployment of the Essensplanung, so it
 * never uses up the daily limit of the Kasse. Only the photo goes to the model, nothing is stored.
 */

/** The check thinks like the one of the Belege; the Essensplanung's own questions are shorter. */
function deployment() {
  return { ...CONFIG.essensplanung.ki, reasoningEffort: CONFIG.belege.check.reasoningEffort };
}

const KI_FEHLER = () =>
  new PlanungError(
    502,
    'KI_FEHLER',
    'Das Foto konnte gerade nicht gelesen werden. Trag die Angaben selbst ein.'
  );

/** Asks the model; a busy or slow deployment becomes `KiNichtVerfuegbar`. */
async function frage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof AzureOpenAiError) {
      if (error.status === 429 || error.status === 503)
        throw new KiNichtVerfuegbar(error.status, error.retryAfterSeconds);
      if (error.timedOut) throw new KiNichtVerfuegbar(503);
    }
    throw KI_FEHLER();
  }
}

export type BelegPruefungAntwort =
  | { available: false; check: null; rotation: 0 }
  | { available: true; check: BelegCheck }
  | { available: true; rotation: BelegRotation };

/**
 * Checks a JPEG (the endpoint checked it) or, with `nurDrehung`, only asks how to turn it
 * upright. Without a deployment it answers `available: false` and the form goes on without.
 */
export async function belegPruefen(
  zugang: Zugang,
  jpeg: Uint8Array,
  nurDrehung: boolean
): Promise<BelegPruefungAntwort> {
  if (!darfBearbeiten(zugang.zugang)) throw NUR_LESEN();
  if ((await loadEssenEinstellungen(getDb())).einstellungen.wartung) throw WARTUNG();
  if (!isKiConfigured()) return { available: false, check: null, rotation: 0 };
  if (nurDrehung) {
    return { available: true, rotation: await frage(() => frageBelegDrehung(deployment(), jpeg)) };
  }
  return { available: true, check: await frage(() => frageBelegPruefung(deployment(), jpeg)) };
}
