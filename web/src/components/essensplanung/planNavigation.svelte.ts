import { tick } from 'svelte';
import { gerichtAusHash, planungHash, tokenAusHash } from '../../lib/essensplanung';

/**
 * Where the page of a Planung stands: the area (tab) and the dish shown on its own page. A dish
 * gets an address of its own (`#t=…&g=12`), so the browser's back button, a reload and a link
 * opened in a new tab show it; „Zurück“ goes back to where it was opened from.
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

/** What an entry of the browser's history holds. */
interface Eintrag {
  essensplanung: true;
  bereich: Bereich;
  gericht: number | null;
  von: Bereich | null;
  scroll: number;
}

function istEintrag(wert: unknown): wert is Eintrag {
  return typeof wert === 'object' && wert !== null && 'essensplanung' in wert;
}

export class PlanNavigation {
  bereich = $state<Bereich>('plan');
  /** The dish shown on its own page in the area of the dishes, or null for the list. */
  gericht = $state<number | null>(null);
  /** Where the dish was opened from in this tab; null when the page started on it. */
  von = $state<Bereich | null>(null);
  /** Counts the dishes opened, so the page puts the focus into the one just opened. */
  geoeffnet = $state(0);
  /** Whether the focus goes to the name of the dish just opened (a new one), not its heading. */
  zumNamen = false;
  #token = '';

  /** Reads the address once the token is known; returns the cleanup. */
  start(token: string): () => void {
    this.#token = token;
    const gericht = gerichtAusHash(window.location.hash);
    if (gericht !== null) {
      this.bereich = 'gerichte';
      this.gericht = gericht;
      // A reload keeps the entry, so „Zurück“ still goes where the dish was opened from
      const eintrag: unknown = history.state;
      if (istEintrag(eintrag) && eintrag.gericht === gericht) this.von = eintrag.von;
    }
    const onPop = (event: PopStateEvent): void => void this.#zurueckgeblaettert(event.state);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }

  async #zurueckgeblaettert(state: unknown): Promise<void> {
    if (istEintrag(state)) {
      this.bereich = state.bereich;
      this.gericht = state.gericht;
      this.von = state.von;
      await tick();
      window.scrollTo(0, state.scroll);
      return;
    }
    // Another fragment such as „Zum Inhalt springen“ (#main) keeps what is shown
    if (tokenAusHash(window.location.hash, 't') !== this.#token) return;
    this.gericht = gerichtAusHash(window.location.hash);
    this.von = null;
    if (this.gericht !== null) this.bereich = 'gerichte';
  }

  #eintrag(scroll = window.scrollY): Eintrag {
    return {
      essensplanung: true,
      bereich: this.bereich,
      gericht: this.gericht,
      von: this.von,
      scroll,
    };
  }

  /** Shows an area; the tab of the dishes, clicked again on a dish, goes back to the list. */
  waehle(bereich: Bereich): void {
    if (bereich === 'gerichte' && this.bereich === 'gerichte' && this.gericht !== null) {
      // A step of its own, so the browser's back button returns to the dish
      history.replaceState(this.#eintrag(), '');
      this.gericht = null;
      this.von = null;
      history.pushState(this.#eintrag(0), '', planungHash(this.#token));
      window.scrollTo(0, 0);
      return;
    }
    this.bereich = bereich;
    // The address names the dish only while it is shown; the area keeps it open meanwhile
    history.replaceState(
      this.#eintrag(),
      '',
      planungHash(this.#token, bereich === 'gerichte' ? this.gericht : null)
    );
  }

  /** Opens a dish on its own page, e.g. from the list or the plan. */
  async oeffnen(id: number, zumNamen = false): Promise<void> {
    if (this.bereich === 'gerichte' && this.gericht === id) return;
    // The entry left keeps its scroll position, so going back lands where it was
    history.replaceState(this.#eintrag(), '');
    this.von = this.bereich;
    this.bereich = 'gerichte';
    this.gericht = id;
    history.pushState(this.#eintrag(0), '', planungHash(this.#token, id));
    this.zumNamen = zumNamen;
    this.geoeffnet++;
    await tick();
    window.scrollTo(0, 0);
  }

  /** Back from a dish to where it was opened from, or to the list of dishes. */
  zurueck(): void {
    if (this.von !== null) {
      history.back();
      return;
    }
    this.gericht = null;
    history.replaceState(this.#eintrag(0), '', planungHash(this.#token));
    window.scrollTo(0, 0);
  }

  /** The dish shown was deleted: the list takes its place, without a step in the history. */
  weg(): void {
    this.gericht = null;
    this.von = null;
    history.replaceState(this.#eintrag(), '', planungHash(this.#token));
  }
}
