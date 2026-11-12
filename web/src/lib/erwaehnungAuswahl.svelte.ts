import { erwaehnungTreffer } from './protokollErwaehnung';
import type { ErwaehnungSuche } from './protokollErwaehnung';
import type { PersonOption } from './types';

let nextId = 0;

/**
 * The list of people shown while an `@` is typed (#547), with the person picked by the arrow
 * keys. The text field tells it the search at the cursor (`setze`) and passes its keys on
 * (`taste`); `ErwaehnungListe.svelte` shows it. Escape closes the list until the cursor leaves
 * that `@`.
 */
export class ErwaehnungAuswahl {
  readonly id = `erwaehnung-${++nextId}`;
  suche = $state<ErwaehnungSuche | null>(null);
  aktiv = $state(0);
  readonly treffer: PersonOption[];
  readonly offen: boolean;
  /** Start of the `@` whose list was closed with Escape. */
  private verworfen: number | null = null;
  private readonly onwaehle: (person: PersonOption, suche: ErwaehnungSuche) => void;

  constructor(
    personen: () => readonly PersonOption[],
    onwaehle: (person: PersonOption, suche: ErwaehnungSuche) => void
  ) {
    this.onwaehle = onwaehle;
    this.treffer = $derived(this.suche ? erwaehnungTreffer(personen(), this.suche.query) : []);
    this.offen = $derived(this.treffer.length > 0);
  }

  /** The ID of the option picked by the arrow keys, for `aria-activedescendant`. */
  get aktiveId(): string | undefined {
    return this.offen ? `${this.id}-${this.aktiv}` : undefined;
  }

  setze(suche: ErwaehnungSuche | null): void {
    if (suche === null || suche.start !== this.verworfen) this.verworfen = null;
    if (suche !== null && suche.start === this.verworfen) suche = null;
    if (suche?.start !== this.suche?.start || suche?.query !== this.suche?.query) this.aktiv = 0;
    this.suche = suche;
  }

  schliessen(): void {
    this.suche = null;
  }

  waehle(index = this.aktiv): void {
    const person = this.treffer[index];
    const suche = this.suche;
    if (!person || !suche) return;
    this.suche = null;
    this.onwaehle(person, suche);
  }

  /** Handles the keys of the open list; `true` if the key was used and must go no further. */
  taste(event: KeyboardEvent): boolean {
    if (!this.offen || event.isComposing) return false;
    const count = this.treffer.length;
    switch (event.key) {
      case 'ArrowDown':
        this.aktiv = (this.aktiv + 1) % count;
        return true;
      case 'ArrowUp':
        this.aktiv = (this.aktiv - 1 + count) % count;
        return true;
      case 'Enter':
      case 'Tab':
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
        this.waehle();
        return true;
      case 'Escape':
        this.verworfen = this.suche?.start ?? null;
        this.suche = null;
        return true;
      default:
        return false;
    }
  }
}
