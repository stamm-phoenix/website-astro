<script lang="ts">
  import { tick } from 'svelte';
  import { bezahltVonWahl } from '../../lib/essensplanungBelege';
  import type { PlanungMitglied } from '../../lib/types';

  /**
   * Who paid a receipt: the own name first, the other members, or „Jemand anderes …“ with a
   * free name. `wahl` is `m:<id>` or `text`; `ontext` gets a typed name on Enter or when the
   * field is left, `onwahl` a chosen member.
   */

  interface Props {
    id: string;
    mitglieder: PlanungMitglied[];
    wahl: string;
    text: string;
    /** The member who paid so far, choosable even without access. */
    bisher?: number | null;
    /** Their name as the receipt gives it, for a member missing from the view. */
    bisherName?: string;
    disabled?: boolean;
    invalid?: boolean;
    /** Accessible name, e.g. in a table row. */
    label?: string;
    onwahl?: (wahl: string) => void;
    ontext?: (text: string) => void;
    onescape?: () => void;
    /** „Jemand anderes …“ was chosen or its name is typed. */
    ontextwahl?: (text: string) => void;
  }
  let {
    id,
    mitglieder,
    wahl = $bindable(),
    text = $bindable(),
    bisher = null,
    bisherName = '',
    disabled = false,
    invalid = false,
    label,
    onwahl,
    ontext,
    onescape,
    ontextwahl,
  }: Props = $props();

  let textFeld = $state<HTMLInputElement | null>(null);
  const auswahl = $derived(
    [...bezahltVonWahl(mitglieder, bisher, bisherName)].sort(
      (a, b) => Number(b.ich) - Number(a.ich)
    )
  );

  async function gewaehlt(wert: string): Promise<void> {
    wahl = wert;
    if (wert === 'text') {
      ontextwahl?.(text);
      await tick();
      textFeld?.focus();
      return;
    }
    onwahl?.(wert);
  }
</script>

<div class="flex min-w-0 flex-wrap gap-1">
  <select
    {id}
    class="form-input mt-0 min-h-8 min-w-0 flex-1 basis-32 px-1.5 py-0.5 text-sm any-pointer-coarse:min-h-11"
    aria-label={label}
    aria-invalid={invalid && wahl !== 'text' ? 'true' : undefined}
    {disabled}
    value={wahl}
    onchange={(event) => void gewaehlt(event.currentTarget.value)}
  >
    {#if wahl === ''}<option value="" disabled>Bitte wählen</option>{/if}
    {#each auswahl as mitglied (mitglied.id)}
      <option value="m:{mitglied.id}"
        >{mitglied.ich ? `Ich (${mitglied.name})` : mitglied.name}{mitglied.entzogen
          ? ' (kein Zugang mehr)'
          : ''}</option
      >
    {/each}
    <option value="text">Jemand anderes …</option>
  </select>
  {#if wahl === 'text'}
    <input
      bind:this={textFeld}
      bind:value={text}
      type="text"
      maxlength="100"
      class="form-input mt-0 min-h-8 min-w-0 flex-1 basis-32 px-1.5 py-0.5 text-sm any-pointer-coarse:min-h-11"
      aria-label={label ? `${label}: Name` : 'Name'}
      aria-invalid={invalid ? 'true' : undefined}
      placeholder="Name, z. B. Oma Inge"
      {disabled}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          ontext?.(text);
        } else if (event.key === 'Escape') onescape?.();
      }}
      oninput={(event) => ontextwahl?.(event.currentTarget.value)}
      onblur={() => ontext?.(text)}
    />
  {/if}
</div>
