<script lang="ts">
  import { untrack } from 'svelte';
  import LoadState from '../ui/LoadState.svelte';
  import ReloadButton from '../pflege/ReloadButton.svelte';
  import { datumKurz, planungUrl } from '../../lib/essensplanung';
  import { essensplanungMeine } from '../../lib/pflegeStore.svelte';
  import type { LeitungPlanung } from '../../../../api/lib/essen-leitung-model';

  /**
   * The Planungen of the Essensplanung where the login's address is a member, opened with the
   * token of the Leitendenbereich (`api/lib/essen-leitung.ts`) on the public page of the Planung.
   */

  const store = essensplanungMeine.state;

  $effect(() => {
    untrack(() => essensplanungMeine.load({ force: true }));
  });

  const ROLLE: Record<LeitungPlanung['rolle'], string> = {
    besitzer: 'Besitzer:in',
    bearbeiten: 'Bearbeiten',
  };

  function zeitraum(planung: LeitungPlanung): string {
    if (!planung.ersterTag || !planung.letzterTag) return 'ohne Tage';
    return planung.ersterTag === planung.letzterTag
      ? datumKurz(planung.ersterTag)
      : `${datumKurz(planung.ersterTag)} – ${datumKurz(planung.letzterTag)}`;
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <a class="btn-primary" href="/essensplanung" data-astro-reload>Neue Planung anlegen</a>
    <ReloadButton resource={essensplanungMeine} />
  </div>

  <LoadState
    data={store.data}
    loading={store.loading}
    error={store.error}
    loadingText="Deine Essensplanungen werden geladen …"
    onretry={() => void essensplanungMeine.load({ force: true })}
  >
    {#snippet skeleton()}
      <div class="skeleton-element h-40 rounded-[var(--radius-lg)]"></div>
    {/snippet}
    {#snippet children(data)}
      {#if data.planungen.length === 0}
        <p class="text-neutral-700">
          Mit deiner Adresse bist du in keiner Essensplanung Mitglied. Lege eine neue an oder lass
          dich mit deiner Stammes-Adresse einladen.
        </p>
      {:else}
        <ul class="surface divide-y divide-neutral-200">
          {#each data.planungen as planung (planung.planungId)}
            <li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <a
                class="font-semibold text-link underline"
                href={planungUrl(planung.token)}
                data-astro-reload>{planung.name}</a
              >
              <span class="text-sm text-neutral-700">
                {zeitraum(planung)} · {ROLLE[planung.rolle]}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </LoadState>
</div>
