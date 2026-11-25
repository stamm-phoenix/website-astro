<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import FormField from '../pflege/FormField.svelte';
  import type { GerichtLink } from '../../../../api/lib/essen-gerichte-model';

  /**
   * The links of a dish in `GerichtKopf.svelte`: a row each with title and address. The whole
   * block is one field: it saves when the focus leaves it, or when a row is removed.
   */

  interface Props {
    gerichtId: number;
    links: GerichtLink[];
    /** Errors by `links.<row>.<part>`. */
    felder: Record<string, string>;
    /** Enter in a row saves the links. */
    onkeydown: (event: KeyboardEvent) => void;
    onentfernen: (index: number) => void;
  }
  let { gerichtId, links = $bindable(), felder, onkeydown, onentfernen }: Props = $props();
</script>

<fieldset class="space-y-2" data-feld="links">
  <legend class="form-label">Links</legend>
  {#each links as link, index (index)}
    <div class="flex flex-wrap items-end gap-2">
      <FormField
        id="gericht-{gerichtId}-link-{index}-titel"
        label="Titel"
        optional
        class="min-w-0 flex-1"
        error={felder[`links.${index}.titel`]}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            maxlength="100"
            bind:value={link.titel}
            {onkeydown}
          />
        {/snippet}
      </FormField>
      <FormField
        id="gericht-{gerichtId}-link-{index}-url"
        label="Adresse"
        class="min-w-0 flex-[2]"
        error={felder[`links.${index}.url`]}
      >
        {#snippet children(attrs)}
          <input
            {...attrs}
            class="form-input"
            type="url"
            placeholder="https://"
            bind:value={link.url}
            {onkeydown}
          />
        {/snippet}
      </FormField>
      <ActionButton
        type="button"
        aria-label="Link {index + 1} entfernen"
        onclick={() => onentfernen(index)}
      >
        Entfernen
      </ActionButton>
    </div>
  {/each}
  <ActionButton
    type="button"
    disabled={links.length >= 10}
    onclick={() => links.push({ titel: '', url: '' })}
  >
    Link hinzufügen
  </ActionButton>
</fieldset>
