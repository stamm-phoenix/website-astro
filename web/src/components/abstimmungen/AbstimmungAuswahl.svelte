<script lang="ts">
  import type { AbstimmungOption } from '../../lib/abstimmungen';
  import { stimmenText } from '../../lib/abstimmungen';

  interface Props {
    /** Unique on the page; names the group of inputs. */
    id: string;
    optionen: AbstimmungOption[];
    mehrfach: boolean;
    /** IDs of the chosen options. */
    gewaehlt: number[];
    disabled?: boolean;
  }
  let { id, optionen, mehrfach, gewaehlt = $bindable(), disabled = false }: Props = $props();

  function toggle(optionId: number, checked: boolean): void {
    if (!mehrfach) {
      gewaehlt = checked ? [optionId] : [];
      return;
    }
    gewaehlt = checked
      ? optionen.map((o) => o.id).filter((o) => o === optionId || gewaehlt.includes(o))
      : gewaehlt.filter((o) => o !== optionId);
  }
</script>

<fieldset {disabled} class="min-w-0">
  <legend class="font-semibold text-brand-900">
    {mehrfach ? 'Wähle alle Optionen, die für dich passen' : 'Wähle eine Option'}
  </legend>
  <ul class="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
    {#each optionen as option (option.id)}
      <li>
        <label class="form-check-row flex min-h-11 cursor-pointer items-center gap-3 py-2">
          <input
            class="form-check shrink-0"
            type={mehrfach ? 'checkbox' : 'radio'}
            name="{id}-auswahl"
            value={option.id}
            checked={gewaehlt.includes(option.id)}
            onchange={(event) => toggle(option.id, event.currentTarget.checked)}
          />
          <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{option.text}</span>
          <span class="shrink-0 text-sm text-neutral-700">{stimmenText(option.stimmen)}</span>
        </label>
      </li>
    {/each}
  </ul>
  {#if !mehrfach && gewaehlt.length > 0}
    <button
      type="button"
      class="mt-1 min-h-11 text-sm font-semibold text-link underline"
      onclick={() => (gewaehlt = [])}>Auswahl aufheben</button
    >
  {/if}
</fieldset>
