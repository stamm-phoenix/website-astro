<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError } from '../../lib/api';
  import type { PlanKontext } from './planKontext';

  /**
   * One field under the packing list for what else has to go along; Enter puts it on the list.
   * The typed name belongs to the list (`text`), which also guards it, so it survives this field
   * being hidden, e.g. while the maintenance mode is on.
   */

  interface Props {
    kontext: PlanKontext;
    text: string;
  }
  let { kontext, text = $bindable() }: Props = $props();

  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  let feld = $state<HTMLInputElement | null>(null);

  async function hinzufuegen(): Promise<void> {
    const name = text.trim().replace(/\s+/g, ' ');
    if (speichert || !name) return;
    fehler = null;
    speichert = true;
    /** What the server said about the name, e.g. that it is on the list already. */
    let feldFehler: string | undefined;
    const ok = await kontext.aendern(async () => {
      try {
        return await kontext.api.senden('POST', '/packliste', { name });
      } catch (error: unknown) {
        if (error instanceof ApiError) feldFehler = error.fields?.name;
        throw error;
      }
    }, `${name} steht auf der Packliste.`);
    speichert = false;
    if (!ok) {
      // The input stays, so it can be changed and sent once more
      fehler = feldFehler ?? kontext.fehler;
      if (feldFehler) kontext.hinweis(null);
      return;
    }
    text = '';
    // The field is enabled again only after the update
    await tick();
    feld?.focus();
  }
</script>

<div class="space-y-1 print:hidden">
  <label class="form-label" for="packliste-neu">Noch etwas einpacken</label>
  <div class="flex flex-wrap gap-2">
    <input
      id="packliste-neu"
      bind:this={feld}
      bind:value={text}
      class="form-input min-h-11 min-w-0 flex-1 basis-56"
      placeholder="z. B. Gaskocher"
      maxlength="100"
      disabled={speichert}
      aria-invalid={fehler ? 'true' : undefined}
      aria-describedby={fehler ? 'packliste-neu-fehler' : undefined}
      onkeydown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void hinzufuegen();
      }}
    />
    <ActionButton
      type="button"
      variant="primary"
      disabled={speichert || !text.trim()}
      onclick={() => void hinzufuegen()}>Auf die Packliste</ActionButton
    >
  </div>
  {#if fehler}
    <p id="packliste-neu-fehler" class="text-sm text-danger" role="alert">{fehler}</p>
  {/if}
</div>
