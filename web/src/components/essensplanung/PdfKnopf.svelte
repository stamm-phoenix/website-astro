<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import { errorMessage } from '../../lib/api';
  import { gespeichert, type PlanKontext } from './planKontext';

  /**
   * Builds a PDF of a view and downloads it; says while it works and when it fails. Waits while
   * a change is saved, so the PDF never shows the state before it.
   */

  interface Props {
    kontext: PlanKontext;
    /** „Einkaufsliste als PDF“. */
    label: string;
    /** Accessible name when the visible label is not unique, e.g. per dish. */
    ariaLabel?: string;
    disabled?: boolean;
    erstellen: () => Promise<void>;
    /** E.g. a smaller button in a dense toolbar. */
    class?: string;
  }
  let {
    kontext,
    label,
    ariaLabel,
    disabled = false,
    erstellen,
    class: className = '',
  }: Props = $props();

  let laeuft = $state(false);

  async function klick(): Promise<void> {
    if (laeuft) return;
    laeuft = true;
    try {
      // A row left with this click saves first, so the PDF shows what was typed
      if (!(await gespeichert())) {
        kontext.hinweis(
          'Eine Änderung ist noch nicht gespeichert, das PDF wurde nicht erstellt. Speichere sie in der Zeile und versuche es noch einmal.',
          'error'
        );
        return;
      }
      await erstellen();
    } catch (error: unknown) {
      kontext.hinweis(
        errorMessage(
          error,
          'Das PDF konnte nicht erstellt werden. Lade die Seite neu und versuche es noch einmal.'
        ),
        'error'
      );
    } finally {
      laeuft = false;
    }
  }
</script>

<ActionButton
  type="button"
  class="print:hidden {className}"
  aria-label={ariaLabel}
  aria-busy={laeuft}
  disabled={disabled || laeuft || kontext.busy}
  onclick={() => void klick()}>{laeuft ? 'PDF wird erstellt …' : label}</ActionButton
>
