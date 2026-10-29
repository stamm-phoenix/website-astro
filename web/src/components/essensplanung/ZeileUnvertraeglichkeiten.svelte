<script lang="ts">
  import ActionButton from '../ui/ActionButton.svelte';
  import AufklappPfeil from '../ui/AufklappPfeil.svelte';
  import type { EssenKatalog } from '../../lib/types';

  /**
   * For whom a line of a dish is, per intolerance: for all, not for them, or only for them (a
   * replacement). Folded, with the number of choices in the heading.
   */

  interface Props {
    katalog: EssenKatalog;
    /** Per intolerance: '' for everyone, 'ohne' (not for) or 'nur' (only for). */
    unvertraeglich: Record<number, '' | 'ohne' | 'nur'>;
    /** Why the server refused the choice, if it did. */
    fehler?: string;
  }
  let { katalog, unvertraeglich = $bindable(), fehler }: Props = $props();

  const gewaehlt = $derived(Object.values(unvertraeglich).filter(Boolean).length);
  /** Chosen intolerances deleted in the Steuerung meanwhile; they are removed here. */
  const verschwunden = $derived(
    Object.entries(unvertraeglich)
      .filter(([id, art]) => art && !katalog.unvertraeglichkeiten.some((u) => u.id === Number(id)))
      .map(([id]) => Number(id))
  );
</script>

<details>
  <summary
    class="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-brand-900 [&::-webkit-details-marker]:hidden"
  >
    Unverträglichkeiten
    {#if gewaehlt}({gewaehlt}){/if}
    <AufklappPfeil />
  </summary>
  {#if fehler}<p class="text-sm text-danger">{fehler}</p>{/if}
  <ul class="mt-2 space-y-2">
    {#each katalog.unvertraeglichkeiten as u (u.id)}
      <li class="flex items-center justify-between gap-3">
        <label for="zeile-u-{u.id}" class="min-w-0">{u.name}</label>
        <select
          id="zeile-u-{u.id}"
          class="form-input w-40"
          bind:value={() => unvertraeglich[u.id] ?? '', (wert) => (unvertraeglich[u.id] = wert)}
        >
          <option value="">für alle</option>
          <option value="ohne">nicht dafür</option>
          <option value="nur">nur dafür (Ersatz)</option>
        </select>
      </li>
    {/each}
    {#each verschwunden as id (id)}
      <li class="flex items-center justify-between gap-3">
        <span class="min-w-0 text-danger">Gelöscht: nicht mehr in der Liste</span>
        <ActionButton type="button" onclick={() => delete unvertraeglich[id]}
          >Entfernen</ActionButton
        >
      </li>
    {/each}
  </ul>
</details>
