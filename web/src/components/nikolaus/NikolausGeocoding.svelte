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
  let releaseBusy = $state(false);
  /** Without a start time only the person can say that no search runs any more. */
  let releaseConfirmed = $state(false);
  /**
   * When the search counts as hung: the server's remaining time, counted on this device's
   * monotonic clock, so a wrong device clock cannot release a running search.
   */
  let stuckAt = $state<number | null>(null);
  let now = $state(performance.now());
  $effect(() => {
    const remaining = data.geocoding.stuckInMs;
    // A local value, so the effect does not also run on every tick of the timer below
    const at = performance.now();
    now = at;
    stuckAt = remaining === null ? null : at + remaining;
  });
  // The ten minutes may pass while the page is open
  $effect(() => {
    const timer = setInterval(() => (now = performance.now()), 30_000);
    return () => clearInterval(timer);
  });
  const unknownStart = $derived(data.geocoding.startedAt === null);
  const stuck = $derived(stuckAt !== null && now >= stuckAt);
  const releasable = $derived(stuck || (unknownStart && releaseConfirmed));

  async function releaseGeocoding(): Promise<void> {
    if (!data?.geocoding.owner || !releasable) return;
    releaseBusy = true;
    try {
      store.data = await sendApi<StaffNikolausSteuerung>(
        'POST',
        '/intern/pflege/nikolaus-steuerung/geocoding',
        { owner: data.geocoding.owner, confirmedStopped: true }
      );

      releaseConfirmed = false;
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
      <StatusLabel tone="warning" label={stuck || unknownStart ? 'Hängt' : 'Läuft'} />
      Eine Adresssuche läuft seit
      {data.geocoding.startedAt ? formatDateTime(new Date(data.geocoding.startedAt)) : 'unbekannt'}.
      {#if stuck || unknownStart}
        Solange findet keine Adresse ihren Ort.
      {:else}
        Dauert sie länger als zehn Minuten, lässt sich die Sperre lösen.
      {/if}
    </p>
    {#if unknownStart}
      <label class="mt-3 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" class="size-5" bind:checked={releaseConfirmed} />
        Die Suche läuft seit mehr als zehn Minuten.
      </label>
    {/if}
    <div class="mt-3">
      <ActionButton
        variant="secondary"
        type="button"
        disabled={!releasable || releaseBusy}
        aria-busy={releaseBusy}
        onclick={() => void releaseGeocoding()}
      >
        {releaseBusy ? 'Wird gelöst …' : 'Sperre lösen'}
      </ActionButton>
    </div>
  </section>
{/if}
