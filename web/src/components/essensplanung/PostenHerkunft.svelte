<script lang="ts">
  import type { PostenHerkunft } from '../../lib/essensplanungHerkunft';

  /** The dishes a thing on a shopping list is for, „Chili (1_2_1) 2,5 kg“, and extra needs. */

  interface Props {
    herkunft: PostenHerkunft | undefined;
    name: string;
    class?: string;
  }
  let { herkunft, name, class: className = '' }: Props = $props();
</script>

{#if herkunft && (herkunft.gerichte.length || herkunft.zusatz.length)}
  <ul
    class="flex flex-wrap gap-x-3 text-xs font-normal text-neutral-700 no-underline {className}"
    aria-label="Für welche Gerichte: {name}"
  >
    {#each herkunft.gerichte as g (g.einplanungId)}
      <li>
        {g.name} <span class="tabular-nums">({g.kennung})</span>
        <span class="tabular-nums">{g.menge ?? 'nach Gefühl'}</span>
      </li>
    {/each}
    {#each herkunft.zusatz as z (z.id)}
      <li class="tabular-nums">
        {['Zusatzbedarf', z.menge, z.hinweis ? `(${z.hinweis})` : ''].filter(Boolean).join(' ')}
      </li>
    {/each}
  </ul>
{:else}
  <span class="text-xs text-neutral-700 {className}">–</span>
{/if}
