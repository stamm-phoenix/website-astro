<script lang="ts">
  import { postApi } from '../lib/api';
  import type { NikolausVisitProgress } from '../lib/types';

  interface Props {
    /** Management token of the booking. */
    token: string;
    /** Date of the visit (`YYYY-MM-DD`). */
    date: string;
  }

  let { token, date }: Props = $props();

  /** How often the progress is reloaded on the visit day. */
  const REFRESH_MS = 120_000;
  /** From this delay on, the family is told that the Nikolaus comes later than planned. */
  const NOTABLE_DELAY_MINUTES = 10;
  /** Dots of the progress bar; longer routes only show the last ones. */
  const MAX_DOTS = 12;

  let progress = $state<NikolausVisitProgress | null>(null);
  let today = $state(berlinDate(new Date()));

  const isBefore = $derived(today < date);
  const isVisitDay = $derived(today === date);

  function berlinDate(instant: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(instant);
  }

  async function load(): Promise<void> {
    try {
      progress = await postApi<NikolausVisitProgress>('/nikolaus/manage/progress', { token });
    } catch {
      // Keep the last state; the next refresh tries again
    }
  }

  // Only on the visit day: load now, then regularly while the page is visible
  $effect(() => {
    if (!isVisitDay) return;
    void load();
    const refresh = (): void => {
      today = berlinDate(new Date());
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  });
</script>

{#if isBefore}
  <div
    class="flex gap-3 rounded-md border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-4 py-3 text-sm text-brand-900"
  >
    <span aria-hidden="true">🎅</span>
    <p>
      <strong>Am Besuchstag</strong> sehen Sie hier, wie viele Besuche der Nikolaus noch vor Ihnen hat
      und wann er voraussichtlich bei Ihnen ist. Speichern Sie sich diesen Link am besten gut ab.
    </p>
  </div>
{:else if isVisitDay && progress && (progress.phase === 'planning' || progress.phase === 'today')}
  <section
    class="surface p-5 md:p-6"
    aria-labelledby="visit-progress-heading"
    role="status"
    aria-live="polite"
  >
    <h3 id="visit-progress-heading" class="font-serif text-xl font-semibold text-brand-900">
      Ihr Nikolausbesuch heute
    </h3>

    {#if progress.phase === 'planning'}
      <p class="mt-2 text-neutral-800">
        Die Tourenplanung für heute läuft noch. Schauen Sie später wieder vorbei – dann sehen Sie
        hier, wann der Nikolaus voraussichtlich bei Ihnen ist.
      </p>
    {:else if progress.visited}
      <p class="mt-2 text-lg font-semibold text-[var(--color-dpsg-pfadfinder)]">
        Der Nikolaus war{progress.visitedAt ? ` um ${progress.visitedAt} Uhr` : ''} bei Ihnen – vielen
        Dank und eine schöne Adventszeit!
      </p>
    {:else}
      <p class="mt-2 text-lg text-neutral-900">
        {#if !progress.started}
          Sie sind der <strong>{progress.position}. Besuch</strong> auf der Tour des Nikolaus.
        {:else if progress.stopsAhead === 0}
          <strong>Der Nikolaus ist als Nächstes bei Ihnen!</strong>
        {:else}
          Der Nikolaus ist noch
          <strong
            >{progress.stopsAhead}
            {progress.stopsAhead === 1 ? 'Besuch' : 'Besuche'}</strong
          >
          von Ihnen entfernt.
        {/if}
      </p>

      {#if progress.started && progress.stopsAhead > 0}
        <div class="mt-3 flex max-w-md items-center gap-1.5" aria-hidden="true">
          <span class="text-lg">🎅</span>
          {#each { length: Math.min(progress.stopsAhead, MAX_DOTS) }, i (i)}
            <span class="h-3 flex-1 rounded-full bg-[var(--color-brand-200)]"></span>
          {/each}
          <span class="text-lg">🏠</span>
        </div>
      {/if}

      <p class="mt-3 text-neutral-800">
        Voraussichtlich <strong>ca. {progress.eta} Uhr</strong>
        {#if progress.delayMinutes >= NOTABLE_DELAY_MINUTES}
          <span class="block text-sm text-[#8a4a00]">
            Das ist etwa {progress.delayMinutes} Minuten später als geplant – danke für Ihre Geduld!
          </span>
        {/if}
      </p>
      <p class="mt-2 text-xs text-neutral-700">
        Die Anzeige aktualisiert sich alle paar Minuten. Wo der Nikolaus gerade ist, zeigen wir
        bewusst nicht.
      </p>
    {/if}
  </section>
{/if}
