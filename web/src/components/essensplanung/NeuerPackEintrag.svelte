<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError } from '../../lib/api';
  import { freiName } from '../../lib/essensplanungPackliste';
  import { zustaendigErfolg } from './packSpeichern';
  import type { PlanKontext } from './planKontext';

  /**
   * The row under the packing list for what else has to go along, with who packs it; Enter puts it
   * on the list and goes back to the name. The typed name and the choice belong to the list
   * (`text`, `wer`), which also guards them, so they survive this row being hidden, e.g. while the
   * maintenance mode is on. Who packs stays chosen for the next thing.
   */

  interface Props {
    kontext: PlanKontext;
    text: string;
    /** `''` nobody, `m:<id>` a member, `neu` the free name `werText`. */
    wer: string;
    werText: string;
  }
  let { kontext, text = $bindable(), wer = $bindable(), werText = $bindable() }: Props = $props();

  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  let feld = $state<HTMLInputElement | null>(null);
  let werFeld = $state<HTMLInputElement | null>(null);

  /** Members with access to choose. */
  const mitglieder = $derived(kontext.ansicht.mitglieder.filter((m) => !m.entzogen));
  // A member chosen before and gone since: nobody again
  $effect(() => {
    if (wer.startsWith('m:') && !mitglieder.some((m) => `m:${m.id}` === wer)) wer = '';
  });

  async function hinzufuegen(): Promise<void> {
    const name = freiName(text);
    if (speichert || !name) return;
    fehler = null;
    speichert = true;
    const zustaendigId = wer.startsWith('m:') ? Number(wer.slice(2)) : null;
    const zustaendigText = wer === 'neu' ? freiName(werText) : '';
    const person = zustaendigId
      ? (mitglieder.find((m) => m.id === zustaendigId)?.name ?? '')
      : zustaendigText;
    /** What the server said about a field, e.g. that the name is on the list already. */
    let feldFehler: string | undefined;
    const ok = await kontext.aendern(
      async () => {
        try {
          return await kontext.api.senden('POST', '/packliste', {
            name,
            zustaendigId,
            zustaendigText,
          });
        } catch (error: unknown) {
          if (error instanceof ApiError && error.fields)
            feldFehler = error.fields.name ?? Object.values(error.fields)[0];
          throw error;
        }
      },
      `${name} steht auf der Packliste.${person ? ` ${zustaendigErfolg(person, name)}` : ''}`
    );
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

  function enter(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void hinzufuegen();
  }

  async function waehlen(wert: string): Promise<void> {
    wer = wert;
    if (wert !== 'neu') return;
    await tick();
    werFeld?.focus();
  }
</script>

<div
  class="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-neutral-200 px-1 py-2 md:grid md:grid-cols-[minmax(0,1fr)_14rem_8rem] print:hidden"
>
  <div class="min-w-0 flex-1 basis-56">
    <label class="form-label text-xs" for="packliste-neu">Noch etwas einpacken</label>
    <input
      id="packliste-neu"
      bind:this={feld}
      bind:value={text}
      class="form-input mt-0.5 min-h-8 any-pointer-coarse:min-h-11 py-0.5 text-sm"
      placeholder="z. B. Gaskocher"
      maxlength="100"
      disabled={speichert}
      aria-invalid={fehler ? 'true' : undefined}
      aria-describedby={fehler ? 'packliste-neu-fehler' : undefined}
      onkeydown={enter}
    />
  </div>
  <div class="min-w-0 flex-1 basis-40">
    <label class="form-label text-xs" for="packliste-neu-wer">Wer packt?</label>
    <select
      id="packliste-neu-wer"
      class="form-input mt-0.5 min-h-8 any-pointer-coarse:min-h-11 py-0.5 text-sm"
      value={wer}
      disabled={speichert}
      onchange={(event) => void waehlen(event.currentTarget.value)}
      onkeydown={enter}
    >
      <option value="">Niemand</option>
      {#each mitglieder as mitglied (mitglied.id)}
        <option value="m:{mitglied.id}">{mitglied.name}{mitglied.ich ? ' (du)' : ''}</option>
      {/each}
      <option value="neu">Anderer Name …</option>
    </select>
    {#if wer === 'neu'}
      <input
        bind:this={werFeld}
        bind:value={werText}
        class="form-input mt-1 min-h-8 any-pointer-coarse:min-h-11 py-0.5 text-sm"
        aria-label="Anderer Name, wer packt"
        placeholder="Name, z. B. Rover"
        maxlength="100"
        disabled={speichert}
        onkeydown={enter}
      />
    {/if}
  </div>
  <ActionButton
    type="button"
    variant="primary"
    class="min-h-8 px-3 py-1 text-xs whitespace-nowrap any-pointer-coarse:min-h-11"
    disabled={speichert || !text.trim()}
    onclick={() => void hinzufuegen()}>Auf die Packliste</ActionButton
  >
  {#if fehler}
    <p id="packliste-neu-fehler" class="basis-full text-sm text-danger md:col-span-3" role="alert">
      {fehler}
    </p>
  {/if}
</div>
