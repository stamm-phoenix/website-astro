<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { navigate } from 'astro:transitions/client';
  import StaffPageHead from '../StaffPageHead.svelte';
  import ActionButton from '../ui/ActionButton.svelte';
  import FilterTabs from '../ui/FilterTabs.svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadAction from '../ui/ReloadAction.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import AbstimmungDialog from './AbstimmungDialog.svelte';
  import { formatDateTime } from '../../lib/format';
  import { abstimmungHref, abstimmungenStore } from '../../lib/abstimmungen';
  import { antwortenText } from '../../lib/abstimmungZahlen';

  /** Abstimmungen (`docs/abstimmungen.md`): the list, newest first, and creating a new one. */

  const store = abstimmungenStore.state;
  let ansicht = $state<'offen' | 'beendet'>('offen');
  let neu = $state(false);

  $effect(() => {
    untrack(() => void abstimmungenStore.load({ force: true }));
  });

  const liste = $derived(
    (store.data ?? []).filter((a) => (ansicht === 'offen' ? !a.geschlossen : a.geschlossen))
  );
  const counts = $derived({
    offen: (store.data ?? []).filter((a) => !a.geschlossen).length,
    beendet: (store.data ?? []).filter((a) => a.geschlossen).length,
  });
</script>

<StaffPageHead href="/leitendenbereich/abstimmungen">
  {#snippet actions()}
    <ActionButton variant="primary" onclick={() => (neu = true)}>Abstimmung anlegen</ActionButton>
    <ReloadAction
      disabled={store.loading}
      aria-busy={store.loading}
      loadedAt={store.loadedAt}
      onclick={() => void abstimmungenStore.load({ force: true })}
      >{store.loading && store.data ? 'Lädt …' : 'Neu laden'}</ReloadAction
    >
  {/snippet}
</StaffPageHead>

<div class="mt-6 space-y-4">
  <FilterTabs
    label="Abstimmungen"
    options={[
      { value: 'offen', label: 'Laufend', count: counts.offen },
      { value: 'beendet', label: 'Beendet', count: counts.beendet },
    ]}
    value={ansicht}
    onselect={(value) => (ansicht = value)}
  />

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Abstimmungen werden geladen …"
    onretry={() => void abstimmungenStore.load({ force: true })}
  >
    {#if liste.length === 0}
      <p class="py-4 text-sm text-neutral-700">
        {ansicht === 'offen' ? 'Keine laufenden Abstimmungen.' : 'Keine beendeten Abstimmungen.'}
      </p>
    {:else}
      <ul class="divide-y divide-neutral-200 border-y border-neutral-200">
        {#each liste as abstimmung (abstimmung.id)}
          <li data-focus-item>
            <a
              href={abstimmungHref(abstimmung.id)}
              class="flex min-h-11 flex-col gap-1 py-3 hover:bg-neutral-100 sm:flex-row sm:items-center sm:justify-between"
            >
              <span class="min-w-0">
                <span class="block font-semibold text-link [overflow-wrap:anywhere]"
                  >{abstimmung.titel}</span
                >
                <span class="block text-sm text-neutral-700">
                  {abstimmung.eigene ? 'Von dir' : `Von ${abstimmung.erstelltVonName}`} · {formatDateTime(
                    abstimmung.erstelltAm
                  )} · {antwortenText(abstimmung.antworten)}
                </span>
              </span>
              <span class="shrink-0">
                {#if abstimmung.geschlossen}
                  <StatusLabel label="Beendet" />
                {:else if abstimmung.ichGeantwortet}
                  <StatusLabel label="Du hast abgestimmt" tone="success" />
                {:else}
                  <StatusLabel label="Noch nicht abgestimmt" tone="warning" />
                {/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </LoadState>
</div>

<AbstimmungDialog
  open={neu}
  onsaved={async (id) => {
    neu = false;
    abstimmungenStore.invalidate();
    // The closed dialog no longer guards the input when the page changes
    await tick();
    await navigate(abstimmungHref(id));
  }}
  onclose={() => (neu = false)}
/>
