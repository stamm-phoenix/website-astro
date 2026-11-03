<script lang="ts">
  import LoadState from '../ui/LoadState.svelte';
  import StatusLabel from '../ui/StatusLabel.svelte';
  import { datumKurz, planungUrl } from '../../lib/essensplanung';
  import { essensplanungMeine } from '../../lib/pflegeStore.svelte';
  import type { LeitungPlanung } from '../../../../api/lib/essen-leitung-model';

  /**
   * The body of the card „Essensplanung“ on the start page: invitations and the Planungen that
   * are running or still to come (`planungenFuerStartseite`). The dashboard loads the data.
   */

  interface Props {
    planungen: LeitungPlanung[];
    limit: number;
  }
  let { planungen, limit }: Props = $props();

  const store = essensplanungMeine.state;

  function zeitraum(planung: LeitungPlanung): string {
    if (!planung.ersterTag || !planung.letzterTag) return 'ohne Tage';
    return planung.ersterTag === planung.letzterTag
      ? datumKurz(planung.ersterTag)
      : `${datumKurz(planung.ersterTag)} – ${datumKurz(planung.letzterTag)}`;
  }
</script>

<LoadState
  data={store.data}
  loading={store.loading}
  error={store.error}
  loadingText="Essensplanungen werden geladen …"
  onretry={() => void essensplanungMeine.load({ force: true })}
>
  {#snippet skeleton()}{/snippet}
  <ul class="mt-1 divide-y divide-neutral-200" data-testid="meine-essensplanungen">
    {#each planungen.slice(0, limit) as planung (planung.planungId)}
      <li>
        <a href={planungUrl(planung.token)} class="block min-h-11 py-2" data-astro-reload>
          <span class="text-link block truncate font-semibold">{planung.name}</span>
          <span class="flex flex-wrap items-center gap-x-2 text-sm text-neutral-700">
            <span>{zeitraum(planung)}</span>
            {#if planung.neu}<StatusLabel label="Neue Einladung" tone="warning" dot />{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
  {#if planungen.length > limit}
    <p class="pt-2 text-sm text-neutral-700">und {planungen.length - limit} weitere</p>
  {/if}
</LoadState>
