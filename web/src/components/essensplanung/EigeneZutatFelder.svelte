<script lang="ts" module>
  import type { EssenEinheitenart } from '../../../../api/lib/essen-schema';

  /** A new ingredient of the Planung's own, for a name that is not in the list. */
  export interface EigeneZutat {
    kategorieId: number | null;
    einheitenart: EssenEinheitenart | null;
    ernaehrung: '' | 'vegan' | 'vegetarisch' | 'fleisch';
    /** What it contains, unlike the intolerances of a line, which say for whom it is. */
    allergene: number[];
  }

  export const neueEigene = (): EigeneZutat => ({
    kategorieId: null,
    einheitenart: null,
    ernaehrung: '',
    allergene: [],
  });

  /** The body to add it (`POST /zutaten`). */
  export function eigeneBody(name: string, neu: EigeneZutat): Record<string, unknown> {
    return {
      name,
      kategorieId: neu.kategorieId,
      einheitenart: neu.einheitenart,
      vegetarisch: neu.ernaehrung === '' ? null : neu.ernaehrung !== 'fleisch',
      vegan: neu.ernaehrung === '' ? null : neu.ernaehrung === 'vegan',
      allergene: neu.allergene,
    };
  }
</script>

<script lang="ts">
  import FormField from '../pflege/FormField.svelte';
  import { EINHEITENART_LABELS } from '../../lib/essensplanungSteuerung';
  import type { EssenKatalog } from '../../../../api/lib/essen-gerichte-model';

  /** The fields of a new ingredient of the Planung's own in the dialog of a line of a dish. */

  interface Props {
    katalog: EssenKatalog;
    /** The typed name. */
    name: string;
    felder: Record<string, string>;
    eigene: EigeneZutat;
  }
  let { katalog, name, felder, eigene = $bindable() }: Props = $props();
</script>

<fieldset class="space-y-3 border-l-2 border-neutral-300 pl-3">
  <legend class="form-label">Eigene Zutat „{name}“</legend>
  <FormField id="eigene-kategorie" label="Kategorie" error={felder.kategorie}>
    {#snippet children(attrs)}
      <select {...attrs} class="form-input" bind:value={eigene.kategorieId}>
        <option value={null}>Bitte wählen</option>
        {#each katalog.kategorien as kategorie (kategorie.id)}
          <option value={kategorie.id}>{kategorie.name}</option>
        {/each}
      </select>
    {/snippet}
  </FormField>
  <FormField id="eigene-einheitenart" label="Gemessen in" error={felder.einheitenart}>
    {#snippet children(attrs)}
      <select {...attrs} class="form-input" bind:value={eigene.einheitenart}>
        <option value={null}>Bitte wählen</option>
        {#each Object.entries(EINHEITENART_LABELS) as [art, label] (art)}
          <option value={art}>{label}</option>
        {/each}
      </select>
    {/snippet}
  </FormField>
  <FormField id="eigene-ernaehrung" label="Ernährung">
    {#snippet children(attrs)}
      <select {...attrs} class="form-input" bind:value={eigene.ernaehrung}>
        <option value="">Weiß ich nicht</option>
        <option value="vegan">vegan</option>
        <option value="vegetarisch">vegetarisch</option>
        <option value="fleisch">mit Fleisch oder Fisch</option>
      </select>
    {/snippet}
  </FormField>
  <fieldset>
    <legend class="form-label">Enthält</legend>
    {#if felder.allergene}<p class="text-sm text-danger">{felder.allergene}</p>{/if}
    <div class="grid gap-x-4 sm:grid-cols-2">
      {#each katalog.unvertraeglichkeiten as u (u.id)}
        <label class="flex min-h-11 items-center gap-2">
          <input type="checkbox" value={u.id} bind:group={eigene.allergene} />
          {u.name}
        </label>
      {/each}
    </div>
  </fieldset>
</fieldset>
