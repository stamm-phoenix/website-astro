<script lang="ts">
  import type { AbstimmungErgebnis } from '../../lib/abstimmungen';

  /** Everyone who answered against the options: who chose what at a glance. */

  interface Props {
    ergebnis: AbstimmungErgebnis;
  }
  let { ergebnis }: Props = $props();

  let breite = $state(0);
  let tabelle = $state(0);
  /** The table is wider than the screen; the page says so instead of cutting it off. */
  const breiter = $derived(tabelle > breite + 1);
</script>

{#if breiter}
  <p class="mt-3 text-sm text-neutral-700">Wisch zur Seite, um alle Optionen zu sehen.</p>
{/if}
<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling of the wide table) -->
<div
  class="mt-3 overflow-x-auto border-y border-neutral-200"
  role="region"
  aria-label="Tabelle: wer was gewählt hat"
  tabindex={breiter ? 0 : undefined}
  bind:clientWidth={breite}
>
  <table class="border-collapse text-sm" bind:offsetWidth={tabelle}>
    <thead>
      <tr>
        <th
          scope="col"
          class="sticky left-0 z-10 bg-surface px-2 py-2 text-left align-bottom font-semibold text-brand-900"
          >Name</th
        >
        {#each ergebnis.optionen as option (option.id)}
          <th
            scope="col"
            class="min-w-24 max-w-40 px-2 py-2 text-center align-bottom font-semibold text-brand-900 [overflow-wrap:anywhere]"
            >{option.text}</th
          >
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each ergebnis.antworten as antwort, index (index)}
        <tr class="border-t border-neutral-200">
          <th
            scope="row"
            class="sticky left-0 z-10 min-w-28 max-w-40 bg-surface px-2 py-2 text-left font-normal text-neutral-900 break-words"
            >{antwort.name}</th
          >
          {#each ergebnis.optionen as option (option.id)}
            {#if antwort.gewaehlt.includes(option.id)}
              <td class="px-2 py-2 text-center font-semibold text-success"
                ><span aria-hidden="true">✓</span><span class="sr-only">Ja</span></td
              >
            {:else if antwort.vielleicht.includes(option.id)}
              <td class="px-2 py-2 text-center text-neutral-800"
                ><span aria-hidden="true">(✓)</span><span class="sr-only">Vielleicht</span></td
              >
            {:else}
              <td class="px-2 py-2 text-center text-neutral-700"
                ><span aria-hidden="true">–</span><span class="sr-only">Nein</span></td
              >
            {/if}
          {/each}
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr class="border-t-2 border-neutral-300">
        <th
          scope="row"
          class="sticky left-0 z-10 bg-surface px-2 py-2 text-left font-semibold text-brand-900"
          >Ja</th
        >
        {#each ergebnis.optionen as option (option.id)}
          <td class="px-2 py-2 text-center font-semibold tabular-nums">{option.stimmen}</td>
        {/each}
      </tr>
      {#if ergebnis.vielleichtErlaubt}
        <tr>
          <th
            scope="row"
            class="sticky left-0 z-10 bg-surface px-2 py-2 text-left font-semibold text-brand-900"
            >Vielleicht</th
          >
          {#each ergebnis.optionen as option (option.id)}
            <td class="px-2 py-2 text-center tabular-nums">{option.vielleicht}</td>
          {/each}
        </tr>
      {/if}
    </tfoot>
  </table>
</div>
