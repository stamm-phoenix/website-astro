<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import { ApiError } from '../../lib/api';
  import { freiName, type PackAuswahl } from '../../lib/essensplanungPackliste';
  import PackWerDialog from './PackWerDialog.svelte';
  import { personenErfolg } from './packSpeichern';
  import type { PlanKontext } from './planKontext';

  /**
   * The row under the packing list for what else has to go along, with who packs it (any
   * persons, chosen in `PackWerDialog.svelte`); Enter puts it on the list and goes back to the
   * name. The typed name and the choice belong to the list (`text`, `wer`), which also guards
   * them, so they survive this row being hidden, e.g. while the maintenance mode is on. Who packs
   * stays chosen for the next thing.
   */

  interface Props {
    kontext: PlanKontext;
    text: string;
    /** Who packs the next thing: members and free names. */
    wer: PackAuswahl;
  }
  let { kontext, text = $bindable(), wer = $bindable() }: Props = $props();

  let fehler = $state<string | null>(null);
  let speichert = $state(false);
  let waehlt = $state(false);
  let feld = $state<HTMLInputElement | null>(null);

  /** Members with access to choose. */
  const mitglieder = $derived(kontext.ansicht.mitglieder.filter((m) => !m.entzogen));
  // A member chosen before and gone since is no longer chosen
  $effect(() => {
    const da = wer.mitglieder.filter((id) => mitglieder.some((m) => m.id === id));
    if (da.length !== wer.mitglieder.length) wer = { ...wer, mitglieder: da };
  });
  const namen = $derived([
    ...mitglieder.filter((m) => wer.mitglieder.includes(m.id)).map((m) => m.name),
    ...wer.namen,
  ]);
  const werText = $derived(namen.join(', ') || 'Niemand');

  async function hinzufuegen(): Promise<void> {
    const name = freiName(text);
    if (speichert || !name || kontext.ansicht.wartung) return;
    fehler = null;
    speichert = true;
    /** What the server said about a field, e.g. that the name is on the list already. */
    let feldFehler: string | undefined;
    const ok = await kontext.aendern(
      async () => {
        try {
          return await kontext.api.senden('POST', '/packliste', { name, ...wer });
        } catch (error: unknown) {
          if (error instanceof ApiError && error.fields)
            feldFehler = error.fields.name ?? Object.values(error.fields)[0];
          throw error;
        }
      },
      `${name} steht auf der Packliste.${namen.length ? ` ${personenErfolg(name, namen, [], namen.length)}` : ''}`
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
    <span class="form-label text-xs" id="packliste-neu-wer-label">Wer packt?</span>
    <ActionButton
      type="button"
      id="packliste-neu-wer"
      class="mt-0.5 min-h-8 w-full justify-start truncate px-2 py-0.5 text-left text-sm any-pointer-coarse:min-h-11"
      aria-labelledby="packliste-neu-wer-label packliste-neu-wer"
      disabled={speichert}
      onclick={() => (waehlt = true)}>{werText}</ActionButton
    >
  </div>
  <ActionButton
    type="button"
    variant="primary"
    class="min-h-8 px-3 py-1 text-xs whitespace-nowrap any-pointer-coarse:min-h-11"
    disabled={speichert || !text.trim() || kontext.ansicht.wartung}
    onclick={() => void hinzufuegen()}>Auf die Packliste</ActionButton
  >
  {#if fehler}
    <p id="packliste-neu-fehler" class="basis-full text-sm text-danger md:col-span-3" role="alert">
      {fehler}
    </p>
  {/if}
</div>

<PackWerDialog
  {kontext}
  was={waehlt ? freiName(text) || 'das Nächste' : undefined}
  zeile={null}
  start={wer}
  submitLabel="Übernehmen"
  onwahl={async (auswahl) => {
    wer = auswahl;
    return null;
  }}
  onclose={() => (waehlt = false)}
/>
