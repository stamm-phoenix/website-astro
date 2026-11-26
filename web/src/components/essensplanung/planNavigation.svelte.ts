import { tick } from 'svelte';
import { navigate } from 'astro:transitions/client';
import { gerichtAusHash, planungHash, tokenAusHash } from '../../lib/essensplanung';

/**
 * Where the page of a Planung stands: the area (tab) and the dish shown on its own page. A dish
 * gets an address of its own (`#t=…&g=12`), so the browser's back button, a reload and a link
 * opened in a new tab show it; „Zurück“ goes back to where it was opened from.
 *
 * The entries share `history.state` with Astro's ClientRouter (`index`, `scrollX`, `scrollY`)
 * and the trips of `PlanEinkauf.svelte`; like the trips, an entry keeps what others put there
 * and the navigation's own part sits under a key of its own.
 */

export type Bereich =
  | 'plan'
  | 'gerichte'
  | 'teilnehmende'
  | 'einkauf'
  | 'lager'
  | 'packliste'
  | 'belege'
  | 'mitglieder'
  | 'einstellungen';

/** Key in `history.state`. */
const VERLAUF = 'essensplanungSeite';

/** The navigation's part of an entry of the browser's history. */
interface Eintrag {
  bereich: Bereich;
  gericht: number | null;
  von: Bereich | null;
  /**
   * The router's `index` of the entry opening the dish, set when it was pushed. A copy of the
   * part in another entry (the trips spread the state) has another index, so „Zurück“ steps back
   * only from the entry that opened the dish.
   */
  schritt: number | null;
}

function zustand(): Record<string, unknown> {
  const state: unknown = history.state;
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

function eintragVon(state: Record<string, unknown>): Eintrag | null {
  const wert = state[VERLAUF];
  return typeof wert === 'object' && wert !== null && 'bereich' in wert ? (wert as Eintrag) : null;
}

export class PlanNavigation {
  bereich = $state<Bereich>('plan');
  /** The dish shown on its own page in the area of the dishes, or null for the list. */
  gericht = $state<number | null>(null);
  /** Where the dish was opened from; null when the page started on it. */
  von = $state<Bereich | null>(null);
  /** Counts the dishes opened, so the page puts the focus into the one just opened. */
  geoeffnet = $state(0);
  /** Whether the focus goes to the name of the dish just opened (a new one), not its heading. */
  zumNamen = false;
  #token = '';

  /** Reads the address once the token is known; returns the cleanup. */
  start(token: string): () => void {
    this.#token = token;
    // Opened without the link in the address (token from the tab's storage): the router learns
    // the address with the link, so going back between dishes stays on this page
    if (tokenAusHash(window.location.hash, 't') !== token)
      void navigate(`${window.location.pathname}${planungHash(token)}`, { history: 'replace' });
    const gericht = gerichtAusHash(window.location.hash);
    if (gericht !== null) {
      this.bereich = 'gerichte';
      this.gericht = gericht;
      // A reload keeps the entry, so „Zurück“ still goes where the dish was opened from
      const eintrag = eintragVon(zustand());
      if (eintrag?.gericht === gericht) this.von = eintrag.von;
    }
    const onPop = (): void => void this.#zurueckgeblaettert();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }

  async #zurueckgeblaettert(): Promise<void> {
    const state = zustand();
    const eintrag = eintragVon(state);
    if (eintrag) {
      this.bereich = eintrag.bereich;
      this.gericht = eintrag.gericht;
      this.von = eintrag.von;
      // The router scrolls before the area is shown; once it is, the position fits again
      await tick();
      if (typeof state.scrollY === 'number') window.scrollTo(0, state.scrollY);
      return;
    }
    // Another fragment such as „Zum Inhalt springen“ (#main) keeps what is shown
    if (tokenAusHash(window.location.hash, 't') !== this.#token) return;
    this.gericht = gerichtAusHash(window.location.hash);
    this.von = null;
    if (this.gericht !== null) this.bereich = 'gerichte';
  }

  #teil(schritt: number | null): Eintrag {
    return { bereich: this.bereich, gericht: this.gericht, von: this.von, schritt };
  }

  /** Writes what is shown into the current entry, keeping the keys of the router and others. */
  #ersetzen(url?: string): void {
    const bisher = zustand();
    const schritt = eintragVon(bisher)?.schritt ?? null;
    history.replaceState(
      {
        ...bisher,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        [VERLAUF]: this.#teil(schritt),
      },
      '',
      url
    );
  }

  /** A new entry for what is shown, numbered on from the router's index like its own. */
  #neu(url: string): number {
    const { index } = zustand();
    const neu = typeof index === 'number' ? index + 1 : 0;
    // Only the router's keys go along: a trip open in another area is not this entry's
    history.pushState({ index: neu, scrollX: 0, scrollY: 0, [VERLAUF]: this.#teil(neu) }, '', url);
    return neu;
  }

  /** Shows an area; the tab of the dishes, clicked again on a dish, shows the list. */
  waehle(bereich: Bereich): void {
    if (bereich === 'gerichte' && this.bereich === 'gerichte' && this.gericht !== null) {
      // A step of its own, so the browser's back button returns to the dish
      this.#ersetzen();
      this.gericht = null;
      this.von = null;
      this.#neu(planungHash(this.#token));
      window.scrollTo(0, 0);
      return;
    }
    this.bereich = bereich;
    // The address names the dish only while it is shown; the area keeps it open meanwhile
    this.#ersetzen(planungHash(this.#token, bereich === 'gerichte' ? this.gericht : null));
  }

  /** Opens a dish on its own page, e.g. from the list or the plan. */
  async oeffnen(id: number, zumNamen = false): Promise<void> {
    if (this.bereich === 'gerichte' && this.gericht === id) return;
    // The entry left keeps its scroll position, so going back lands where it was
    this.#ersetzen();
    this.von = this.bereich;
    this.bereich = 'gerichte';
    this.gericht = id;
    this.#neu(planungHash(this.#token, id));
    this.zumNamen = zumNamen;
    this.geoeffnet++;
    await tick();
    window.scrollTo(0, 0);
  }

  /** Back from a dish to where it was opened from, or to the list of dishes. */
  zurueck(): void {
    const state = zustand();
    const eintrag = eintragVon(state);
    // Only the entry that opened this dish steps back; the one before it is its origin
    if (
      this.von !== null &&
      eintrag?.gericht === this.gericht &&
      eintrag.schritt !== null &&
      eintrag.schritt === state.index
    ) {
      history.back();
      return;
    }
    this.bereich = this.von ?? 'gerichte';
    this.gericht = null;
    this.von = null;
    this.#ersetzen(planungHash(this.#token));
    window.scrollTo(0, 0);
  }

  /** The dish shown was deleted: the list takes its place, without a step in the history. */
  weg(): void {
    this.gericht = null;
    this.von = null;
    this.#ersetzen(planungHash(this.#token));
  }
}
