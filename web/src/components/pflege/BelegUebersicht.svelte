<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { formatIsoDate } from '../../lib/belege';
  import { BELEG_QUELLEN, type BelegEintrag } from '../../lib/belegEintraege';
  import { formatEuro } from '../../lib/format';
  import { isIch } from '../../lib/ichStore.svelte';

  interface Props {
    eintraege: BelegEintrag[];
    ansicht: 'liste' | 'galerie';
    /** Changes with every load of the receipts; failed previews are tried again then. */
    geladen: string;
    onopen: (eintrag: BelegEintrag) => void;
  }
  let { eintraege, ansicht, geladen, onopen }: Props = $props();

  /** Entries shown at first and added per click, so a phone stays quick with hundreds of them. */
  const PAGE = 60;
  let shown = $state(PAGE);
  /** Previews that could not be loaded show the placeholder instead. */
  const failed = new SvelteSet<string>();

  $effect(() => {
    void geladen;
    failed.clear();
  });

  $effect(() => {
    // Back to the first entries whenever the filters change the list
    void eintraege;
    shown = PAGE;
  });

  const quelleLabel = (eintrag: BelegEintrag) =>
    BELEG_QUELLEN.find((q) => q.value === eintrag.quelle)?.label ?? '';
  const amount = (eintrag: BelegEintrag) =>
    eintrag.hasAmount
      ? `${eintrag.income ? 'Einnahme · ' : ''}${formatEuro(eintrag.amountCent)}`
      : '';
  const meta = (eintrag: BelegEintrag) =>
    [eintrag.date ? formatIsoDate(eintrag.date) : '', eintrag.where].filter(Boolean).join(' · ');
</script>

{#snippet preview(eintrag: BelegEintrag, size: 'klein' | 'gross')}
  {#if eintrag.previewUrl && !failed.has(eintrag.key)}
    <img
      src={eintrag.previewUrl}
      alt=""
      aria-hidden="true"
      width={size === 'gross' ? 300 : 48}
      height={size === 'gross' ? 400 : 64}
      loading="lazy"
      class={size === 'gross'
        ? 'aspect-[3/4] h-auto w-full rounded-md bg-neutral-100 object-cover'
        : 'h-16 w-12 shrink-0 rounded-md bg-neutral-100 object-cover'}
      onerror={() => failed.add(eintrag.key)}
    />
  {:else}
    <span
      aria-hidden="true"
      class={size === 'gross'
        ? 'flex aspect-[3/4] w-full items-center justify-center rounded-md bg-neutral-100 text-neutral-500'
        : 'flex h-16 w-12 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500'}
    >
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4" />
      </svg>
    </span>
  {/if}
{/snippet}

{#snippet tags(eintrag: BelegEintrag)}
  <span class="flex flex-wrap gap-1">
    <span class="tag">{quelleLabel(eintrag)}</span>
    {#each eintrag.tags as tag (tag.label)}
      <span
        class="tag"
        class:text-warning={tag.tone === 'warning'}
        class:text-danger={tag.tone === 'danger'}>{tag.label}</span
      >
    {/each}
  </span>
{/snippet}

{#if ansicht === 'galerie'}
  <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Belege">
    {#each eintraege.slice(0, shown) as eintrag (eintrag.key)}
      <li class="min-w-0">
        <button
          type="button"
          class="card flex h-full w-full flex-col gap-2 p-2 text-left hover:border-[var(--color-brand-300)]"
          onclick={() => onopen(eintrag)}
        >
          {@render preview(eintrag, 'gross')}
          <span class="line-clamp-2 break-words font-semibold text-brand-900">{eintrag.title}</span>
          {#if amount(eintrag)}
            <span class="font-semibold tabular-nums text-brand-900">{amount(eintrag)}</span>
          {/if}
          <StatusLabel label={eintrag.label} tone={eintrag.tone} dot />
          {@render tags(eintrag)}
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <ul class="divide-y divide-neutral-200 border-y border-neutral-200" aria-label="Belege">
    {#each eintraege.slice(0, shown) as eintrag (eintrag.key)}
      <li>
        <button
          type="button"
          class="flex w-full items-start gap-3 py-3 text-left hover:bg-neutral-50"
          onclick={() => onopen(eintrag)}
        >
          {@render preview(eintrag, 'klein')}
          <span class="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:justify-between sm:gap-6">
            <span class="min-w-0">
              <span class="block break-words font-semibold text-brand-900">{eintrag.title}</span>
              {#if meta(eintrag)}
                <span class="block text-sm text-neutral-700">{meta(eintrag)}</span>
              {/if}
              {#if eintrag.paidBy}
                <span class="block text-sm text-neutral-700"
                  >Bezahlt von {eintrag.paidBy}{#if isIch( { name: eintrag.paidBy } )}&nbsp;(ich){/if}</span
                >
              {/if}
              {#if eintrag.hinweis}
                <span class="line-clamp-2 block text-sm text-danger"
                  >Abgelehnt: {eintrag.hinweis}</span
                >
              {/if}
              <span class="mt-1 block">{@render tags(eintrag)}</span>
            </span>
            <span class="shrink-0 sm:text-right">
              {#if amount(eintrag)}
                <span class="block font-semibold tabular-nums text-brand-900"
                  >{amount(eintrag)}</span
                >
              {/if}
              <StatusLabel label={eintrag.label} tone={eintrag.tone} dot />
            </span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
{#if eintraege.length > shown}
  <button type="button" class="btn-secondary mt-3" onclick={() => (shown += PAGE)}>
    Weitere {Math.min(PAGE, eintraege.length - shown)} von {eintraege.length - shown} anzeigen
  </button>
{/if}
