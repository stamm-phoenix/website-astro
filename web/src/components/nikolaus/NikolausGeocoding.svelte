<script lang="ts">
  import { formatDateTime } from '../../lib/format';
  import ActionButton from '../ui/ActionButton.svelte';

  import StatusLabel from '../ui/StatusLabel.svelte';

  import { ApiError, errorMessage, sendApi } from '../../lib/api';
  import { nikolausSteuerung } from '../../lib/pflegeStore.svelte';

  import type { StaffNikolausSteuerung } from '../../lib/types';

  interface Props {
    data: StaffNikolausSteuerung;
    onnotice: (message: string | null, kind: 'success' | 'error') => void;
  }
  let { data, onnotice }: Props = $props();
  const store = nikolausSteuerung.state;
  /** A search that runs this long has hung; only then may its lock be released. */
  const STUCK_AFTER_MS = 10 * 60_000;
  let now = $state(Date.now());
  let releaseBusy = $state(false);

  // The ten minutes may pass while the page is open
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  /** Without a start time nothing says the search is still running, so it counts as stuck. */
  const stuck = $derived(
    data.geocoding.startedAt === null || now - data.geocoding.startedAt >= STUCK_AFTER_MS
  );

  async function releaseGeocoding(): Promise<void> {
    if (!data?.geocoding.owner || !stuck) return;
    releaseBusy = true;
    try {
      store.data = await sendApi<StaffNikolausSteuerung>(
        'POST',
        '/intern/pflege/nikolaus-steuerung/geocoding',
        { owner: data.geocoding.owner, confirmedStopped: true }
      );

      onnotice('Die Sperre der Adresssuche ist gelöst.', 'success');
    } catch (error: unknown) {
      onnotice(
        (error instanceof ApiError && error.fields?.confirmedStopped) ||
          errorMessage(
            error,
            'Die Sperre der Adresssuche wurde nicht gelöst. Prüfe deine Internetverbindung und tippe noch einmal auf „Sperre lösen“.'
          ),
        'error'
      );
    } finally {
      releaseBusy = false;
    }
  }
</script>

{#if data.geocoding.owner}
  <section class="surface p-5 md:p-6" aria-labelledby="geocoding-heading">
    <h2 id="geocoding-heading" class="font-serif text-xl font-bold text-brand-900">Adresssuche</h2>
    <p class="mt-1 text-sm text-neutral-800">
      <StatusLabel tone="warning" label={stuck ? 'Hängt' : 'Läuft'} />
      Eine Adresssuche läuft seit
      {data.geocoding.startedAt ? formatDateTime(new Date(data.geocoding.startedAt)) : 'unbekannt'}.
      {#if stuck}
        Solange findet keine Adresse ihren Ort.
      {:else}
        Dauert sie länger als zehn Minuten, lässt sich die Sperre lösen.
      {/if}
    </p>
    <div class="mt-3">
      <ActionButton
        variant="secondary"
        type="button"
        disabled={!stuck || releaseBusy}
        aria-busy={releaseBusy}
        onclick={() => void releaseGeocoding()}
      >
        {releaseBusy ? 'Wird gelöst …' : 'Sperre lösen'}
      </ActionButton>
    </div>
  </section>
{/if}
