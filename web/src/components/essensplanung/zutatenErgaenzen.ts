import { ApiError } from '../../lib/api';
import { darfBearbeiten } from '../../../../api/lib/essen-planung-model';
import type { PlanungAnsicht } from '../../../../api/lib/essen-planung-model';
import type { PlanKontext } from './planKontext';

/**
 * „Zutaten schnell anlegen“ (`docs/essensplanung.md`): an ingredient added by its name alone has
 * open details. Shortly after the page's own change or loading shows one, the page asks the AI to
 * fill them in for all such ingredients at once, outside the queue of changes, so typing goes on
 * meanwhile; changes of others that come with the regular update do not ask, so several open
 * pages do not ask at once. Each ingredient is asked about once per page; „Angaben ergänzen (KI)“
 * in the list of ingredients asks again.
 */

/** Waits so several lines typed in a row go in one question. */
const WARTEN_MS = 1500;

/** The names it filled in, for the message: „Zucchini und Hokkaido“. */
export function ergaenztText(namen: readonly string[]): string {
  const liste =
    namen.length <= 3
      ? namen.length > 1
        ? `${namen.slice(0, -1).join(', ')} und ${namen.at(-1)}`
        : (namen[0] ?? '')
      : `${namen.slice(0, 2).join(', ')} und ${namen.length - 2} weiteren`;
  return `Angaben zu ${liste} von der KI ergänzt. Prüfe sie unter „Zutaten dieser Planung“.`;
}

/** Whether ingredients of the view wait for the AI, given those asked about already. */
export function wartendeZutaten(ansicht: PlanungAnsicht, gefragt: ReadonlySet<number>): number[] {
  if (!darfBearbeiten(ansicht.zugang) || ansicht.wartung) return [];
  return ansicht.zutaten
    .filter((zutat) => zutat.angaben === 'offen' && !gefragt.has(zutat.id))
    .map((zutat) => zutat.id);
}

const frageKi = (kontext: PlanKontext) =>
  kontext.api.senden<{ ansicht: PlanungAnsicht; ergaenzt: string[] }>('POST', '/ki/zutaten');

/** Asks now, as a change of the member, e.g. after the AI was busy; says what it filled in. */
export async function zutatenJetztErgaenzen(kontext: PlanKontext): Promise<boolean> {
  let namen: string[] = [];
  const ok = await kontext.aendern(async () => {
    const antwort = await frageKi(kontext);
    namen = antwort.ergaenzt;
    return antwort;
  });
  if (ok)
    kontext.hinweis(namen.length ? ergaenztText(namen) : 'Es waren keine Angaben mehr offen.');
  return ok;
}

/**
 * Asks in the background; `pruefe` looks at the view and asks soon when an ingredient has open
 * details.
 */
export function zutatenErgaenzung(kontext: PlanKontext): { pruefe: () => void } {
  const gefragt = new Set<number>();
  /** The AI is not set up here: nothing is asked any more. */
  let aus = false;
  let laeuft = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function imHintergrund(): Promise<void> {
    const ids = wartendeZutaten(kontext.ansicht, gefragt);
    if (aus || laeuft || !ids.length) return;
    for (const id of ids) gefragt.add(id);
    laeuft = true;
    try {
      const { ergaenzt } = await frageKi(kontext);
      // The view comes through the queue, so it never goes back behind a change made meanwhile
      if (ergaenzt.length) await kontext.aendern(() => kontext.api.laden(), ergaenztText(ergaenzt));
    } catch (error: unknown) {
      // Without the AI the stand-ins stay; the list of ingredients offers to ask again
      if (error instanceof ApiError && error.code === 'KI_AUS') aus = true;
    } finally {
      laeuft = false;
    }
    // More than fit into one question, or added meanwhile
    pruefe();
  }

  function pruefe(): void {
    if (aus || laeuft || !wartendeZutaten(kontext.ansicht, gefragt).length) return;
    clearTimeout(timer);
    timer = setTimeout(() => void imHintergrund(), WARTEN_MS);
  }

  return { pruefe };
}
