import type { planungApi } from '../../lib/essensplanung';
import type { PlanungAnsicht } from '../../lib/types';

/** What the parts of the page of a Planung share (`EssensplanungApp.svelte`). */
export interface PlanKontext {
  readonly ansicht: PlanungAnsicht;
  /** A change is running; buttons wait. */
  readonly busy: boolean;
  readonly api: ReturnType<typeof planungApi>;
  /** The token of the page's own link. */
  readonly token: string;
  /**
   * Runs a change and shows the new view; conflicts load the current state. Returns whether it
   * worked.
   */
  aendern(
    work: () => Promise<PlanungAnsicht | { ansicht: PlanungAnsicht } | undefined>,
    erfolg?: string
  ): Promise<boolean>;
  /** The message of the last failed change, for dialogs that cover the page's own notice. */
  readonly fehler: string | null;
  hinweis(text: string | null, art?: 'success' | 'error'): void;
  zeige(ansicht: PlanungAnsicht): void;
}

let verloren: string[] = [];

/**
 * Names input that went with a part someone else deleted, so it can be copied. Parts that go in
 * the same update share one notice, shown after it, as a change during it would not show.
 */
export function meldeVerloren(kontext: PlanKontext, text: string): void {
  if (!verloren.length)
    setTimeout(() => {
      kontext.hinweis(verloren.join(' '), 'error');
      verloren = [];
    });
  verloren.push(text);
}

const speichernd = new Set<Promise<boolean>>();

/** Notes a save a row started on its own, e.g. when it was left; it says whether it worked. */
export function merkeSpeichern(lauf: Promise<boolean>): void {
  speichernd.add(lauf);
  void lauf.finally(() => speichernd.delete(lauf));
}

/**
 * Waits for the saves rows started on their own, including one that waits for the click just
 * made, so an action reads the state with what was typed (a PDF, the version to delete).
 * Whether all of them worked; a failed one keeps its input and shows its error in the row.
 */
export async function gespeichert(): Promise<boolean> {
  await new Promise((done) => setTimeout(done));
  let alle = true;
  while (speichernd.size) {
    const ergebnisse = await Promise.allSettled([...speichernd]);
    if (ergebnisse.some((e) => e.status === 'rejected' || !e.value)) alle = false;
  }
  return alle;
}
