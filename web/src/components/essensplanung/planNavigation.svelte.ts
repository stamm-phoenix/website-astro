import { tick } from 'svelte';
import { navigate } from 'astro:transitions/client';
import { gerichtAusHash, planungHash, tokenAusHash } from '../../lib/essensplanung';
import {
  alsZustand,
  eintragVon,
  fremdeTeile,
  indexVon,
  oeffnenderSchritt,
  VERLAUF,
  type Bereich,
  type Eintrag,
} from './planVerlauf';

export type { Bereich } from './planVerlauf';

/**
 * Where the page of a Planung stands: the area (tab) and the dish shown on its own page. A dish
 * gets an address of its own (`#t=…&g=12`), so the browser's back button, a reload and a link
 * opened in a new tab show it; „Zurück“ goes back to where it was opened from.
 *
 * New entries are made by Astro's ClientRouter (`navigate`), so its count of entries stays in
 * step with the guard against lost input (`unsavedChanges.ts`); replacing an entry keeps what the
 * router and the trips of `PlanEinkauf.svelte` put there (`planVerlauf.ts`).
 */
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
      void navigate(this.#adresse(null), { history: 'replace' });
    const gericht = gerichtAusHash(window.location.hash);
    if (gericht !== null) {
      this.bereich = 'gerichte';
      this.gericht = gericht;
      // A reload keeps the entry, so „Zurück“ still goes where the dish was opened from
      const eintrag = eintragVon(history.state);
      if (eintrag?.gericht === gericht) this.von = eintrag.von;
    }
    const onPop = (): void => void this.#zurueckgeblaettert();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }

  async #zurueckgeblaettert(): Promise<void> {
    const state = alsZustand(history.state);
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

  #adresse(gericht: number | null): string {
    return `${window.location.pathname}${planungHash(this.#token, gericht)}`;
  }

  #teil(schritt: number | null): Eintrag {
    return { bereich: this.bereich, gericht: this.gericht, von: this.von, schritt };
  }

  /** Writes what is shown into the current entry, keeping the keys of the router and others. */
  #ersetzen(url?: string, schritt = eintragVon(history.state)?.schritt ?? null): void {
    const bisher = alsZustand(history.state);
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

  /** A new entry for what is shown, made by the router; it remembers its index as the step. */
  #neu(gericht: number | null): void {
    // Others' keys go along, e.g. the trip open in „Einkauf“, so it stays open; the router sets
    // its own. For an address on the same page it pushes at once, before the promise settles
    void navigate(this.#adresse(gericht), {
      history: 'push',
      state: { ...fremdeTeile(history.state), [VERLAUF]: this.#teil(null) },
    });
    this.#ersetzen(undefined, indexVon(history.state));
  }

  /** Shows an area; the tab of the dishes, clicked again on a dish, shows the list. */
  waehle(bereich: Bereich): void {
    if (bereich === 'gerichte' && this.bereich === 'gerichte' && this.gericht !== null) {
      // A step of its own, so the browser's back button returns to the dish
      this.#ersetzen();
      this.gericht = null;
      this.von = null;
      this.#neu(null);
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
    this.#neu(id);
    this.zumNamen = zumNamen;
    this.geoeffnet++;
    await tick();
    window.scrollTo(0, 0);
  }

  /**
   * From a dish to the plan or the list of dishes. Back to where it was opened from, the history
   * steps back, so the position there stays; otherwise a step of its own, so the browser's back
   * button returns to the dish.
   */
  zurueck(ziel: 'plan' | 'gerichte'): void {
    if (this.von === ziel && oeffnenderSchritt(history.state, this.gericht)) {
      history.back();
      return;
    }
    this.#ersetzen();
    this.bereich = ziel;
    this.gericht = null;
    this.von = null;
    this.#neu(null);
    window.scrollTo(0, 0);
  }

  /** The dish shown was deleted: the list takes its place, without a step in the history. */
  weg(): void {
    this.gericht = null;
    this.von = null;
    this.#ersetzen(planungHash(this.#token));
  }
}
