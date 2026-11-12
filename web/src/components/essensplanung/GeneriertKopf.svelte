<script lang="ts">
  import TagInput from '../pflege/TagInput.svelte';
  import LazyTextEditor from '../ui/LazyTextEditor.svelte';
  import type { Gericht } from '../../lib/types';

  /**
   * Instructions and tools of a dish the AI wrote, to check before they are taken over with the
   * ingredients. Instructions the dish has already are only replaced when ticked; tools are added
   * to the ones it has.
   */

  interface Props {
    gericht: Gericht;
    /** What the AI wrote: those fields stay to edit, even once emptied. */
    angeboten: { anleitung: boolean; werkzeuge: boolean };
    anleitung: string;
    anleitungAn: boolean;
    werkzeuge: string[];
    werkzeugeAn: boolean;
    fehler: Record<string, string>;
    /** While saving: the editor is no form field, so a disabled fieldset does not lock it. */
    gesperrt: boolean;
  }
  let {
    gericht,
    angeboten,
    anleitung = $bindable(),
    anleitungAn = $bindable(),
    werkzeuge = $bindable(),
    werkzeugeAn = $bindable(),
    fehler,
    gesperrt,
  }: Props = $props();
  const hatAnleitung = $derived(gericht.anleitung.trim() !== '');
</script>

<div class="space-y-3">
  {#if angeboten.anleitung}
    <div class="space-y-2">
      <label class="form-check-row cursor-pointer text-sm">
        <input
          type="checkbox"
          class="form-check"
          data-testid="generiert-anleitung-an"
          bind:checked={anleitungAn}
        />
        <span
          >{hatAnleitung
            ? 'Anleitung ersetzen (die bisherige Anleitung geht verloren)'
            : 'Anleitung übernehmen'}</span
        >
      </label>
      <span class="sr-only" id="generiert-anleitung-label">Anleitung</span>
      {#if anleitungAn}
        <div inert={gesperrt}>
          <LazyTextEditor
            id="generiert-anleitung"
            labelledBy="generiert-anleitung-label"
            invalid={Boolean(fehler['kopf.anleitung'])}
            placeholder="z. B. Zwiebeln anbraten, dann …"
            maxLength={20_000}
            bind:value={anleitung}
          />
        </div>
      {/if}
      {#if fehler['kopf.anleitung']}<p class="text-sm text-danger">
          {fehler['kopf.anleitung']}
        </p>{/if}
    </div>
  {/if}
  {#if angeboten.werkzeuge}
    <div class="space-y-2">
      <label class="form-check-row cursor-pointer text-sm">
        <input
          type="checkbox"
          class="form-check"
          data-testid="generiert-werkzeuge-an"
          bind:checked={werkzeugeAn}
        />
        <span
          >{gericht.werkzeuge.length
            ? 'Werkzeuge zu den bisherigen ergänzen'
            : 'Werkzeuge übernehmen'}</span
        >
      </label>
      <label class="sr-only" for="generiert-werkzeuge">Werkzeuge</label>
      <TagInput
        id="generiert-werkzeuge"
        tags={werkzeuge}
        placeholder="z. B. Pürierstab"
        kompakt
        disabled={!werkzeugeAn}
        invalid={Boolean(fehler['kopf.werkzeuge'])}
        onchange={(neu) => (werkzeuge = neu)}
      />
      {#if fehler['kopf.werkzeuge']}<p class="text-sm text-danger">
          {fehler['kopf.werkzeuge']}
        </p>{/if}
    </div>
  {/if}
</div>
