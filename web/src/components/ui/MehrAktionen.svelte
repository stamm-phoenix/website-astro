<script lang="ts" module>
  export interface MehrAktion {
    label: string;
    onclick: () => void;
    disabled?: boolean;
    /** `danger` for a step that removes something; it still asks before it does. */
    variant?: 'secondary' | 'danger';
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import ActionButton from './ActionButton.svelte';
  import ActionSheet from './ActionSheet.svelte';

  /**
   * Rarely used actions of a block behind „⋯ Mehr“. With a single action there is no menu:
   * the action stands as its own button, so nobody opens a menu to find one entry.
   */
  interface Props {
    aktionen: MehrAktion[];
    /** Title of the sheet, e.g. „Weitere Aktionen zum Protokoll“. */
    title?: string;
    /** The item the actions belong to, for screen readers in a list of items, e.g. its title. */
    bezug?: string;
    class?: string;
  }
  let { aktionen, title = 'Weitere Aktionen', bezug, class: className = '' }: Props = $props();

  let open = $state(false);

  /** Closes the sheet first, so a dialog the action opens does not stay under it. */
  async function waehle(aktion: MehrAktion): Promise<void> {
    open = false;
    await tick();
    aktion.onclick();
  }
</script>

{#if aktionen.length === 1}
  {@const [aktion] = aktionen}
  <ActionButton
    class={className}
    variant={aktion.variant ?? 'secondary'}
    disabled={aktion.disabled}
    onclick={aktion.onclick}
  >
    {aktion.label}{#if bezug}<span class="sr-only"> ({bezug})</span>{/if}
  </ActionButton>
{:else if aktionen.length > 1}
  <ActionButton class={className} aria-haspopup="dialog" onclick={() => (open = true)}>
    <span aria-hidden="true">⋯</span> Mehr{#if bezug}<span class="sr-only"> ({bezug})</span>{/if}
  </ActionButton>
  <ActionSheet {open} {title} onclose={() => (open = false)}>
    <div class="grid gap-3">
      {#each aktionen as aktion (aktion.label)}
        <ActionButton
          variant={aktion.variant ?? 'secondary'}
          disabled={aktion.disabled}
          onclick={() => void waehle(aktion)}
        >
          {aktion.label}
        </ActionButton>
      {/each}
    </div>
  </ActionSheet>
{/if}
