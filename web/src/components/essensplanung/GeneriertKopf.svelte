<script lang="ts">
  import TagInput from '../pflege/TagInput.svelte';
  import type { Gericht } from '../../lib/types';

  /**
   * Instructions and tools of a dish the AI wrote, to check before they are taken over with the
   * ingredients. Instructions the dish has already are only replaced when ticked; tools are added
   * to the ones it has.
   */

  interface Props {
    gericht: Gericht;
    anleitung: string;
    anleitungAn: boolean;
    werkzeuge: string[];
    werkzeugeAn: boolean;
    fehler: Record<string, string>;
  }
  let {
    gericht,
    anleitung = $bindable(),
    anleitungAn = $bindable(),
    werkzeuge = $bindable(),
    werkzeugeAn = $bindable(),
    fehler,
  }: Props = $props();
  const hatAnleitung = $derived(gericht.anleitung.trim() !== '');
</script>

<div class="space-y-3">
  {#if anleitung}
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
      <label class="sr-only" for="generiert-anleitung">Anleitung</label>
      <textarea
        id="generiert-anleitung"
        class="form-input min-h-40"
        maxlength="20000"
        disabled={!anleitungAn}
        aria-invalid={fehler['kopf.anleitung'] ? 'true' : undefined}
        bind:value={anleitung}></textarea>
      {#if fehler['kopf.anleitung']}<p class="text-sm text-danger">
          {fehler['kopf.anleitung']}
        </p>{/if}
    </div>
  {/if}
  {#if werkzeuge.length}
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
